/* 10.3 (Asana 1218657160170244) - Firebase web config for the bet-entry form.
   Project nfl-edge-q (10.0). LIVE S1 (SPRINT 2026-10-11, Asana 1219384872975724, D3): the web app "NFL Edge site"
   (appId 1:480184351216:web:3dbfc366e539147b0f8535) was registered with `firebase apps:create WEB` on 2026-10-11 and the
   six values below are its SDK config (`firebase apps:sdkconfig WEB <appId>`). A web config is NOT a secret: it is served
   to every visitor by design. Protection comes from Firebase Auth (Google sign-in, the GitHub Pages host in the authorized
   domains) and the Firestore rules (firebase/firestore.rules), whose allowlist of three emails lives only in the deployed
   rules and never here. The pre-S1 placeholder shape is kept as a test fixture in
   firebase/tests/fixtures/firebase-config.placeholder.js (the layout checks and the headless bet-entry test run against
   scratch copies that carry that fixture, never this file).

   Emulator mode (local flag, never on the live site): open the page with ?emulator=1, or set
   localStorage['nfl-edge-emulator'] = '1'. The page then talks to the Auth emulator on localhost:9099 and the Firestore
   emulator on localhost:8080 (firebase.json), with a fake API key the emulators accept, and exposes window.nflEdgeTest
   for the headless test (firebase/tests/ui.test.mjs). */
(function () {
  'use strict';
  var CONFIG = {
    apiKey: 'AIzaSyDWan2xdu3HL1dGyYPKwbHeHQNfmEIu9zU',
    authDomain: 'nfl-edge-q.firebaseapp.com',
    projectId: 'nfl-edge-q',
    storageBucket: 'nfl-edge-q.firebasestorage.app',
    messagingSenderId: '480184351216',
    appId: '1:480184351216:web:3dbfc366e539147b0f8535'
  };
  var emulator = false;
  try {
    emulator = /[?&]emulator=1(&|$)/.test(location.search) || localStorage.getItem('nfl-edge-emulator') === '1';
  } catch (e) { emulator = /[?&]emulator=1(&|$)/.test(location.search); }
  var configured = CONFIG.apiKey.indexOf('PLACEHOLDER') !== 0;
  window.NFL_EDGE_FIREBASE = {
    config: emulator ? { apiKey: 'fake-api-key', authDomain: 'localhost', projectId: 'nfl-edge-q', appId: 'emulator' } : CONFIG,
    emulator: emulator,
    emulatorHosts: { auth: 'http://localhost:9099', firestoreHost: 'localhost', firestorePort: 8080 },
    enabled: emulator || configured,
    reason: emulator ? 'emulator' : (configured ? 'configured' : 'Firebase web app not configured yet (placeholder config): Q registers the web app and pastes its config into site/assets/firebase-config.js')
  };
})();
