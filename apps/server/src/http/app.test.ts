import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('http app', () => {
  it('answers health check', async () => {
    const res = await createApp().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns json 404 for unknown api routes', async () => {
    const res = await createApp().request('/api/nope');
    expect(res.status).toBe(404);
  });
});
