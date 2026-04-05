// ═══════════════════════════════════════════════════════════════
//  RetailCheck — Shared Firebase Auth Helper (auth.js)
//  Included by both retailcheck-landing.html and shoplog.html
// ═══════════════════════════════════════════════════════════════

// Firebase SDKs (loaded via CDN in each HTML file)
// firebase-app, firebase-auth, firebase-firestore must be loaded first

// ── Initialise Firebase (called once, guard against re-init)
function initFirebase() {
  if (firebase.apps && firebase.apps.length) return firebase.apps[0];
  return firebase.initializeApp(FIREBASE_CONFIG);
}

// ── Sign in with email + password
// Returns: { ok: true, user, profile } on success
//          { ok: false, code, message } on failure
async function rcSignIn(email, password) {
  try {
    initFirebase();
    const auth = firebase.auth();
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const uid  = cred.user.uid;

    // Load user profile from Firestore
    const db   = firebase.firestore();
    const snap = await db.collection('users').doc(uid).get();

    if (!snap.exists) {
      // Auth record exists but no Firestore profile — treat as basic user
      return {
        ok: true,
        user: cred.user,
        profile: {
          email:       cred.user.email,
          storeName:   cred.user.email,
          licensedTo:  cred.user.email,
          plan:        'professional',
          expiry:      '2099-12-31',
        }
      };
    }

    const profile = snap.data();

    // Check subscription expiry
    if (profile.expiry && new Date(profile.expiry) < new Date()) {
      await auth.signOut();
      return { ok: false, code: 'subscription-expired', message: 'subscription-expired' };
    }

    return { ok: true, user: cred.user, profile };

  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}

// ── Sign out
async function rcSignOut() {
  try {
    initFirebase();
    await firebase.auth().signOut();
    // Clear cached profile from sessionStorage
    sessionStorage.removeItem('rc_profile');
  } catch (e) {
    console.warn('Sign-out error:', e);
  }
}

// ── Get current signed-in user (returns null if not signed in)
function rcCurrentUser() {
  initFirebase();
  return firebase.auth().currentUser;
}

// ── Auth guard — call at top of shoplog.html
// Redirects to landing page if not signed in
// Calls callback(profile) if signed in
function rcRequireAuth(callback) {
  initFirebase();
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      // Not signed in — send to login page
      window.location.replace('login.html');
      return;
    }

    // Try sessionStorage cache first (avoids extra Firestore read)
    const cached = sessionStorage.getItem('rc_profile');
    if (cached) {
      try {
        const profile = JSON.parse(cached);
        callback(profile);
        return;
      } catch(e) {}
    }

    // Load profile from Firestore
    try {
      const db   = firebase.firestore();
      const snap = await db.collection('users').doc(user.uid).get();
      const profile = snap.exists ? snap.data() : {
        email:      user.email,
        storeName:  user.email,
        licensedTo: user.email,
        plan:       'professional',
        expiry:     '2099-12-31',
      };

      // Check expiry
      if (profile.expiry && new Date(profile.expiry) < new Date()) {
        await rcSignOut();
        window.location.replace('login.html?expired=1');
        return;
      }

      // Cache profile for this session
      sessionStorage.setItem('rc_profile', JSON.stringify(profile));
      callback(profile);
    } catch(e) {
      console.error('Profile load error:', e);
      // Allow access with minimal profile on Firestore error
      callback({ email: user.email, storeName: user.email, plan: 'professional', expiry: '2099-12-31' });
    }
  });
}

// ── Map Firebase error codes to friendly messages
function rcAuthError(code) {
  const map = {
    'auth/user-not-found':       'No account found with that email address.',
    'auth/wrong-password':       'Incorrect password. Please try again.',
    'auth/invalid-email':        'Please enter a valid email address.',
    'auth/user-disabled':        'This account has been disabled. Contact support@retailcheck.co.uk.',
    'auth/too-many-requests':    'Too many failed attempts. Please wait a few minutes and try again.',
    'auth/network-request-failed':'Network error. Please check your internet connection.',
    'auth/invalid-credential':   'Incorrect email or password. Please try again.',
    'subscription-expired':      'Your subscription has expired. Please contact support@retailcheck.co.uk to renew.',
  };
  return map[code] || 'Sign-in failed. Please try again or contact support@retailcheck.co.uk.';
}

// ── Send password reset email
async function rcResetPassword(email) {
  try {
    initFirebase();
    await firebase.auth().sendPasswordResetEmail(email);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: rcAuthError(err.code) };
  }
}
