import { randomUUID } from 'node:crypto';
import { defaults, location as printLocation } from './print-model.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const short = (value, max = 160) => String(value ?? '').trim().slice(0, max);
const guid = value => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const VALID_SCREENS = new Set(['A till at the counter','A screen in the kitchen','A screen the customer can see','A receipt printer']);
const EXPECTED_SOURCE = 'restaurant-ops-v3-site';

export function normalizeWebsiteAccount(value) {
  if (!value || typeof value !== 'object') fail(400, 'Use your Customli website account to import details.');
  const snapshot = value.snapshot && typeof value.snapshot === 'object' ? value.snapshot : value;
  const org = snapshot.organization || {}, loc = snapshot.locations?.[0] || {}, onboarding = snapshot.onboarding || {};
  const intake = onboarding.intake_data || {};
  const organizationId = short(org.id, 64), locationId = short(loc.id, 64);
  if (!guid(organizationId) || !guid(locationId)) fail(400, 'Website restaurant identifiers are missing.');
  if (!Array.isArray(snapshot.locations) || snapshot.locations.length !== 1)
    fail(409, 'Choose a single restaurant location in your Customli website account first.');
  const restaurantName = short(loc.name || intake.restaurantName || org.name, 120);
  if (!restaurantName) fail(400, 'Restaurant name is missing.');
  const timezone = short(loc.timezone || '', 80), currency = short(loc.currency || '', 3).toUpperCase();
  if (!timezone || !/^[A-Z]{3}$/.test(currency)) fail(400, 'Complete the restaurant time zone and currency first.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { fail(400, 'Restaurant timezone is invalid.'); }
  const screens = Array.isArray(intake.screens) ? [...new Set(intake.screens.filter(x => VALID_SCREENS.has(x)))] : [];
  const restaurantAddress = short([loc.address_line1, loc.address_line2, loc.city, loc.region, loc.postal_code].filter(Boolean).join(', ') || intake.restaurantAddress, 500);
  return { organizationId, locationId, restaurantName, restaurantAddress, timezone, currency,
    locationsRequested: short(intake.locations, 24), screens, source: EXPECTED_SOURCE, sourceVersion: Number(intake.version) || 1 };
}

const existingCustomerRecords = db => {
  const present = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
  return ['products','orders','shifts'].some(name => present.has(name) && db.prepare('SELECT 1 FROM ' + name + ' LIMIT 1').get());
};

export function setupPreview(profile, db = null) {
  const products = db ? db.prepare('SELECT COUNT(*) AS n FROM products WHERE active=1').get().n : 0;
  const shift = db ? Boolean(db.prepare('SELECT 1 FROM shifts WHERE closed_at IS NULL LIMIT 1').get()) : false;
  const migrationRequired = Boolean(db && !savedProfile(db) && existingCustomerRecords(db));
  const localeSupported = profile?.currency === 'THB' && profile?.timezone === 'Asia/Bangkok';
  const screens = profile?.screens || [];
  return {
    profile,
    suggestions: {
      pos: { enabled: true, mode: 'counter', reason: 'POS is available for counter sales.' },
      kds: { suggested: screens.includes('A screen in the kitchen'), station: 'Kitchen', connection: 'not_verified' },
      customerDisplay: { suggested: screens.includes('A screen the customer can see'), connection: 'not_verified' },
      printer: { suggested: screens.includes('A receipt printer'), connection: 'not_verified' },
      receipts: { businessName: profile?.restaurantName || '', address: profile?.restaurantAddress || '' },
      reports: { enabled: true, source: 'recorded_sales' }
    },
    readiness: {
      profile: Boolean(profile?.restaurantName && profile?.organizationId),
      locale: localeSupported,
      menu: products > 0,
      shiftOpen: shift,
      hardwareVerified: false,
      migrationRequired,
      counterSaleReady: Boolean(profile?.restaurantName && localeSupported && products > 0 && shift && !migrationRequired),
      missing: [
        ...(!profile?.restaurantName ? ['Import your website restaurant details'] : []),
        ...(migrationRequired ? ['Existing V5 restaurant data requires an owner-approved migration before account linking'] : []),
        ...(profile && !localeSupported ? ['Confirm supported currency and reporting timezone'] : []),
        ...(products === 0 ? ['Add or import a menu'] : []),
        ...(!shift ? ['Confirm opening cash and open the shift'] : [])
      ]
    }
  };
}

export function migrateOnboarding(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS restaurant_setup(
    id TEXT PRIMARY KEY CHECK(id='primary'),
    organization_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    source TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    approved_by TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS restaurant_setup_events(
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    action TEXT NOT NULL, occurred_at TEXT NOT NULL, details TEXT NOT NULL
  );`);
}

const savedProfile = db => {
  const row = db.prepare("SELECT profile_json FROM restaurant_setup WHERE id='primary'").get();
  return row ? JSON.parse(row.profile_json) : null;
};
function updateBlankReceiptTemplates(db, profile, actor) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='receipt_templates'").get()) return 0;
  const loc = printLocation(db);
  const rows = db.prepare(`SELECT t.id,t.version,v.config,v.actor_id FROM receipt_templates t
    JOIN receipt_template_versions v ON v.template_id=t.id AND v.version=t.version
    WHERE t.location_id=?`).all(loc);
  let updated = 0;
  for (const row of rows) {
    const config = JSON.parse(row.config);
    // A customer's edited templates must NEVER be overwritten by onboarding.
    if (row.version !== 1 || row.actor_id !== 'system' || config.businessName || config.address) continue;
    const modified = { ...config, businessName: profile.restaurantName, address: profile.restaurantAddress,
      timezone: profile.timezone };
    if (JSON.stringify(modified) === JSON.stringify(config)) continue;
    db.prepare('INSERT INTO receipt_template_versions VALUES(?,?,?,?,?,?)').run(row.id, 2, loc, JSON.stringify(modified), actor, new Date().toISOString());
    db.prepare('UPDATE receipt_templates SET version=2 WHERE id=? AND version=1').run(row.id);
    updated++;
  }
  return updated;
}

export function handleOnboarding({ db, p, method, b, user, res, send }) {
  if (!p.startsWith('/onboarding')) return null;
  if (user.role !== 'Owner') fail(403, 'Only the restaurant owner can configure setup.');
  if (p === '/onboarding' && method === 'GET')
    return send(res, 200, setupPreview(savedProfile(db), db));
  if (p === '/onboarding/preview' && method === 'POST') {
    const profile = normalizeWebsiteAccount(b);
    return send(res, 200, setupPreview(profile, db));
  }
  if (p === '/onboarding/apply' && method === 'POST') {
    const profile = normalizeWebsiteAccount(b);
    // V5 is presently single-location and THB/Bangkok-specific.
    // Never allow the customer to be incorrectly provisioned into another restaurant.
    if (profile.currency !== 'THB' || profile.timezone !== 'Asia/Bangkok')
      fail(409, 'This V5 location currently supports THB and Asia/Bangkok only. No settings changed.');
    const before = savedProfile(db);
    if (before && (before.organizationId !== profile.organizationId || before.locationId !== profile.locationId))
      fail(409, 'This V5 location is already linked to a different restaurant. No settings changed.');
    if (!before && existingCustomerRecords(db))
      fail(409, 'Existing V5 sales, shifts or menu need a reviewed migration before linking a new website restaurant. No settings changed.');
    const changed = !before || JSON.stringify(before) !== JSON.stringify(profile);
    if (changed) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`INSERT INTO restaurant_setup(id,organization_id,location_id,profile_json,source,updated_at,approved_by)
          VALUES('primary',?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json,updated_at=excluded.updated_at,approved_by=excluded.approved_by`)
          .run(profile.organizationId, profile.locationId, JSON.stringify(profile), profile.source, new Date().toISOString(), user.id);
        const templates = updateBlankReceiptTemplates(db, profile, 'onboarding:' + user.id);
        db.prepare('INSERT INTO restaurant_setup_events VALUES(?,?,?,?,?,?)')
          .run(randomUUID(), profile.organizationId, user.id, 'website_intake_approved', new Date().toISOString(),
            JSON.stringify({ sourceVersion: profile.sourceVersion, templatesUpdated: templates }));
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    }
    return send(res, 200, { ...setupPreview(savedProfile(db), db), changed });
  }
  fail(404, 'Setup action not found.');
}
