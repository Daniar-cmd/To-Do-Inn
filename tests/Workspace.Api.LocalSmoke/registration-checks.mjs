import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export async function checkRegistration({ call, request, sql, readMail, expireLimits, existingUsername, existingEmail, existingPassword }) {
    const auth = 'auth.php';
    const password = 'SignupSmoke8!';
    const organizationEmail = 'organisation@example.test';
    const ownerEmail = 'new-owner@example.test';
    const nextEmail = 'new-member@example.test';
    const digest = value => createHash('sha256').update(value).digest('hex');

    async function session() {
        const options = { jar: new Map() };
        return { options, token: (await call(auth, 200, undefined, undefined, options)).csrf_token };
    }

    const action = (client, status, name, fields = {}) =>
        call(auth, status, { action: name, ...fields }, client.token, client.options);
    const personal = (email, username) => ({
        email, username, first_name: 'Анна', last_name: 'Иванова', password,
        confirm_password: password, personal_data_consent: true,
    });
    async function verify(client, email) {
        const sent = await action(client, 200, 'send_verification_code', { email });
        assert.equal(sent.test_code, '285868');
        await action(client, 200, 'verify_email_code', { email, code: sent.test_code });
    }
    function invitationFor(email, firstIndex) {
        const mail = readMail().slice(firstIndex).find(message => message.to.includes(email));
        assert.ok(mail);
        const match = mail.text.match(/\/pages\/corporate-invitation\.html\?token=([a-f0-9]{64})\b/);
        assert.ok(match);
        assert.ok(mail.html.includes(match[0]));
        return match[1];
    }

    expireLimits();
    const blocked = await session();
    await action(blocked, 422, 'register', personal('unverified@example.test', '@Unverified'));
    await action(blocked, 422, 'send_verification_code', { email: 'invalid' });
    const mailBeforeCodes = readMail().length;
    const codeEmail = 'attempts@example.test';
    await action(blocked, 200, 'send_verification_code', { email: codeEmail });
    for (let attempt = 0; attempt < 4; attempt++) {
        await action(blocked, 422, 'verify_email_code', { email: codeEmail, code: '000000' });
    }
    const lockedCode = await request(auth, { action: 'verify_email_code', email: codeEmail, code: '000000' },
        blocked.token, blocked.options);
    assert.equal(lockedCode.response.status, 429);
    await action(blocked, 422, 'verify_email_code', { email: codeEmail, code: '285868' });
    assert.equal(readMail().length, mailBeforeCodes);

    const founder = await session();
    await action(founder, 409, 'validate_registration_username', { username: existingUsername });
    await action(founder, 422, 'validate_corporate_admin_identifier', { identifier: '@UnknownAdmin' });
    await action(founder, 200, 'validate_corporate_admin_identifier', { identifier: existingUsername });
    await verify(founder, organizationEmail);
    await action(founder, 422, 'verify_email_code', { email: organizationEmail, code: '285868' });
    const stranger = await session();
    const company = {
        ...personal(organizationEmail.toUpperCase(), '@LocalOrganisation'),
        account_type: 'corporate', organization_type: 'ООО', organization_name: 'Smoke Organisation Two',
        administrators: [{ role: 'owner', identifier: ownerEmail }, { role: 'manager', identifier: existingUsername }],
    };
    await action(stranger, 422, 'register', company);
    await action(founder, 422, 'register', { ...company, personal_data_consent: false });
    await action(founder, 422, 'register', { ...company, administrators: [{ role: 'owner', identifier: ownerEmail },
        { role: 'owner', identifier: existingUsername }] });
    expireLimits();
    const org = await action(founder, 201, 'register', company);
    assert.equal(org.user, null);
    assert.deepEqual(org.invitation_delivery_failures, []);
    const organizationId = org.corporate_account.id;
    assert.ok(Number.isSafeInteger(organizationId));
    assert.equal(sql('SELECT root_email FROM corporate_accounts WHERE id = ' + organizationId), organizationEmail);
    assert.equal(readMail().length, mailBeforeCodes + 2);
    const ownerInvitation = invitationFor(ownerEmail, mailBeforeCodes);
    const managerInvitation = invitationFor(existingEmail, mailBeforeCodes);
    assert.equal(sql("SELECT invitation_token_hash FROM corporate_account_members WHERE corporate_account_id = "
        + organizationId + " AND role = 'owner'"), digest(ownerInvitation));
    assert.equal(sql('SELECT count(*) FROM boards WHERE corporate_account_id = ' + organizationId), '0');

    expireLimits();
    const owner = await session();
    await call(auth, 403, { action: 'accept_corporate_invitation', token: ownerInvitation }, undefined, owner.options);
    const duplicate = await session();
    const acceptance = await Promise.all([owner, duplicate].map(client => request(auth,
        { action: 'accept_corporate_invitation', token: ownerInvitation }, client.token, client.options)));
    assert.deepEqual(acceptance.map(result => result.response.status).sort(), [200, 422]);
    assert.deepEqual(acceptance.find(result => result.response.ok).body.data, { registered: false, role: 'owner' });
    assert.equal(sql('SELECT count(*) FROM boards WHERE corporate_account_id = ' + organizationId), '0');
    assert.deepEqual(await action(stranger, 200, 'accept_corporate_invitation', { token: managerInvitation }),
        { registered: true, role: 'manager' });
    await action(stranger, 422, 'accept_corporate_invitation', { token: managerInvitation });
    assert.equal(sql('SELECT count(*) FROM boards WHERE corporate_account_id = ' + organizationId), '0');

    await verify(owner, ownerEmail);
    sql(`CREATE FUNCTION smoke_reject_list() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Smoke-only list failure'; END; $$;
        CREATE TRIGGER smoke_reject_list BEFORE INSERT ON task_lists FOR EACH ROW EXECUTE FUNCTION smoke_reject_list()`);
    try {
        await action(owner, 503, 'register', personal(ownerEmail, '@SmokeOwner'));
        assert.equal(sql("SELECT count(*) FROM users WHERE email = 'new-owner@example.test'"), '0');
        assert.equal(sql('SELECT count(*) FROM boards WHERE corporate_account_id = ' + organizationId), '0');
    } finally {
        sql('DROP TRIGGER smoke_reject_list ON task_lists; DROP FUNCTION smoke_reject_list()');
    }
    const registration = await action(owner, 201, 'register', personal(ownerEmail, '@SmokeOwner'));
    const ownerId = registration.user.id;
    assert.ok(Number.isSafeInteger(ownerId));
    assert.equal(sql("SELECT user_id, accepted_at IS NOT NULL, invitation_token_hash IS NULL FROM corporate_account_members "
        + 'WHERE corporate_account_id = ' + organizationId + " AND role = 'owner'"), ownerId + '|t|t');
    assert.equal(sql('SELECT count(*) FROM boards b JOIN task_lists l ON l.board_id = b.id '
        + 'WHERE b.corporate_account_id = ' + organizationId + ' AND b.user_id = ' + ownerId), '1');

    const ownerToken = (await call(auth, 200, undefined, undefined, owner.options)).csrf_token;
    const signedInOwner = { ...owner, token: ownerToken };
    const ownerInbox = await action(signedInOwner, 200, 'get_notifications');
    assert.ok(ownerInbox.unread_count > 0);
    const ownerNotice = ownerInbox.notifications.find(notification => !notification.is_read);
    assert.ok(ownerNotice);
    const foreignNotice = Number(sql("SELECT n.id FROM notifications n JOIN users u ON u.id = n.user_id "
        + "WHERE u.username = '@DotnetSmoke' LIMIT 1"));
    assert.ok(Number.isSafeInteger(foreignNotice) && foreignNotice > 0);
    await action(signedInOwner, 404, 'mark_notification_read', { notification_id: foreignNotice });
    for (let attempt = 0; attempt < 2; attempt++) {
        assert.deepEqual(await action(signedInOwner, 200, 'mark_notification_read', { notification_id: ownerNotice.id }), { read: true });
    }
    const updatedInbox = await action(signedInOwner, 200, 'get_notifications');
    assert.equal(updatedInbox.unread_count, ownerInbox.unread_count - 1);
    assert.equal(updatedInbox.notifications.find(notification => notification.id === ownerNotice.id).is_read, true);
    const root = await session();
    await action(root, 200, 'login', { username: company.username, password });
    root.token = (await call(auth, 200, undefined, undefined, root.options)).csrf_token;
    assert.ok((await action(root, 200, 'get_notifications')).notifications.some(notification => notification.sender === 'ToDo-Inn!'));
    await action(root, 404, 'mark_notification_read', { notification_id: ownerNotice.id });

    const invitation = { action: 'invite_member', corporate_account_id: organizationId, identifier: nextEmail, role: 'admin' };
    const mailBeforeInvite = readMail().length;
    const manager = await session();
    await action(manager, 200, 'login', { username: existingUsername, password: existingPassword });
    const managerToken = (await call(auth, 200, undefined, undefined, manager.options)).csrf_token;
    await call('workspace.php', 403, invitation, managerToken, manager.options);
    assert.equal(readMail().length, mailBeforeInvite);
    assert.deepEqual(await call('workspace.php', 201, invitation, ownerToken, owner.options),
        { invited: true, email_sent: true });
    await call('workspace.php', 409, { ...invitation, identifier: nextEmail.toUpperCase() }, ownerToken, owner.options);
    assert.equal(readMail().length, mailBeforeInvite + 1);
    const nextInvitation = invitationFor(nextEmail, mailBeforeInvite);
    assert.equal(sql("SELECT invitation_token_hash FROM corporate_account_members WHERE corporate_account_id = "
        + organizationId + " AND role = 'admin'"), digest(nextInvitation));
    assert.deepEqual(await action(stranger, 200, 'accept_corporate_invitation', { token: nextInvitation }),
        { registered: false, role: 'admin' });
    console.log('Registration, verification codes, invitation delivery, concurrent acceptance and rollback verified.');
}
