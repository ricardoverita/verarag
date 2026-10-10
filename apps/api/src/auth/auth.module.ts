import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.js';
import { UsersRepository } from './users.repository.js';

@Module({
  imports: [OrganizationsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersRepository,
    // The default Argon2id parameters; tests can override the provider.
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
  ],
})
export class AuthModule {}
