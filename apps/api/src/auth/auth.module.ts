import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthMetrics } from './auth.metrics.js';
import { AuthService } from './auth.service.js';
import { LoginAttempts } from './login-attempts.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionCookie } from './session-cookie.js';
import { SessionService } from './session.service.js';
import { SessionsRepository } from './sessions.repository.js';
import { UsersRepository } from './users.repository.js';

@Module({
  imports: [OrganizationsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    AuthMetrics,
    SessionService,
    SessionCookie,
    SessionsRepository,
    UsersRepository,
    // Factories because both take plain values in their constructors.
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
    { provide: LoginAttempts, useFactory: () => new LoginAttempts() },
  ],
  exports: [AuthGuard, AuthService, SessionService, SessionCookie, PasswordHasher, UsersRepository],
})
export class AuthModule {}
