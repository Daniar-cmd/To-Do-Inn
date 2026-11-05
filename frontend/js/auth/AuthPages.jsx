import React from 'react';
import { LoginPage } from './LoginPage.jsx';
import { RegisterPage } from './RegisterPage.jsx';
import { RecoveryPage } from './RecoveryPage.jsx';
import { CorporateInvitationPage } from './CorporateInvitationPage.jsx';
import { RegistrationSuccessPage } from './RegistrationSuccessPage.jsx';
import { OrganizationRootPage } from './OrganizationRootPage.jsx';

export function AuthPages({ page }) {
  if (page === 'register') return <RegisterPage />;
  if (page === 'corporate-invitation') return <CorporateInvitationPage />;
  if (page === 'organization-root') return <OrganizationRootPage />;
  if (page === 'recovery') return <RecoveryPage />;
  if (page === 'registration-success') return <RegistrationSuccessPage />;
  return <LoginPage />;
}
