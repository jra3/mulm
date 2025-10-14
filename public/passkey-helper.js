// SimpleWebAuthn Browser Helper
// Imports from esm.sh CDN to avoid bundling complexity

import { startRegistration, startAuthentication } from 'https://esm.sh/@simplewebauthn/browser@13.2.2';

// Make available globally for Pug templates
window.passkeyHelper = {
  startRegistration,
  startAuthentication
};

console.log('Passkey helper loaded');
