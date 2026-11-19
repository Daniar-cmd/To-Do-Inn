import React from 'react';
import { LoginPage } from './LoginPage.tsx';
import { RegisterPage } from './RegisterPage.tsx';
import { RecoveryPage } from './RecoveryPage.tsx';
import { CorporateInvitationPage } from './CorporateInvitationPage.tsx';
import { RegistrationSuccessPage } from './RegistrationSuccessPage.tsx';
import { OrganizationRootPage } from './OrganizationRootPage.tsx';

export function AuthPages({ page }: { page: string }) {
  if (page === 'register') return <RegisterPage />;
  if (page === 'corporate-invitation') return <CorporateInvitationPage />;
  if (page === 'organization-root') return <OrganizationRootPage />;
  if (page === 'recovery') return <RecoveryPage />;
  if (page === 'registration-success') return <RegistrationSuccessPage />;
  return <LoginPage />;
}
