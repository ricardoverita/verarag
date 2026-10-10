import { Inject, Injectable } from '@nestjs/common';
import { parseCookie } from 'cookie';
import type { CookieOptions, Request, Response } from 'express';

import { CONFIG, type Config } from '../config/config.js';

/**
 * The session cookie: HttpOnly so scripts cannot read it, SameSite=Lax so
 * other sites cannot send it with POST requests, and Secure with the
 * `__Host-` prefix outside local development.
 */
@Injectable()
export class SessionCookie {
  private readonly name: string;
  private readonly options: CookieOptions;

  constructor(@Inject(CONFIG) config: Config) {
    this.name = config.sessions.cookieName;
    this.options = {
      httpOnly: true,
      secure: config.sessions.cookieSecure,
      sameSite: 'lax',
      path: '/',
    };
  }

  read(req: Request): string | undefined {
    const header = req.headers.cookie;
    return header ? parseCookie(header)[this.name] : undefined;
  }

  write(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.name, token, { ...this.options, expires: expiresAt });
  }

  clear(res: Response): void {
    res.clearCookie(this.name, this.options);
  }
}
