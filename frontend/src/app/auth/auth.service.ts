import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface AuthUser {
  username: string;
}

/**
 * The session lives in a cookie the browser sends on its own, so there is no token to keep
 * here: what this holds is only whether the app is allowed to paint itself.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  /**
   * Three states, not two: `undefined` is "not asked yet". Starting at null would flash the
   * login screen on every reload of an already signed-in session.
   */
  readonly user = signal<AuthUser | null | undefined>(undefined);

  /** Asked once on boot. A 401 here is the normal answer for a visitor, not a failure. */
  async probe(): Promise<void> {
    try {
      this.user.set(await firstValueFrom(this.http.get<AuthUser>('/api/auth/me')));
    } catch {
      this.user.set(null);
    }
  }

  async login(username: string, password: string): Promise<void> {
    this.user.set(
      await firstValueFrom(this.http.post<AuthUser>('/api/auth/login', { username, password })),
    );
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<void>('/api/auth/logout', {}));
    } finally {
      // The client forgets either way: a logout that failed on the server still means the
      // person in front of the screen asked to be out.
      this.user.set(null);
    }
  }
}
