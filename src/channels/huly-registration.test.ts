/**
 * Integration test for the huly channel's single reach-in: the self-registration
 * import in the `src/channels/index.ts` barrel. Importing the barrel runs huly.ts's
 * top-level `registerChannelAdapter('huly', …)`; without the import the channel is
 * silently absent at host boot.
 *
 * Behavior, not structural: it imports the real barrel and asserts the registry
 * actually contains the channel. Importing is safe — registration is a pure
 * top-level call and huly.ts touches the network only inside its factory
 * (`readConfig()` returns null with no creds, so the factory is a no-op in CI).
 */
import { describe, it, expect } from 'vitest';

import { getRegisteredChannelNames } from './channel-registry.js';
import './index.js'; // the real barrel — triggers every channel's self-registration

describe('huly channel registration', () => {
  it('registers huly via the channel barrel', () => {
    expect(getRegisteredChannelNames()).toContain('huly');
  });
});
