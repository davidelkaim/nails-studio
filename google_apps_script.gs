// ============================================================
//  NAILS STUDIO — Google Apps Script
//  OAuth Proxy for Google Calendar
//  Deploy as Web App under linoyelkaim@gmail.com
//  Execute as: Me (linoyelkaim@gmail.com)
//  Access: Anyone
// ============================================================

const CLIENT_ID = '898276215811-7ebiohpch5pqm7o3sastqvqn6m8bds52.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz60amZhS1EFg6CD53DfMH4S55Ui0pqSTbVsl-zhYorvsGmSwNdPk9K6F3NEqA4HReeew/exec';

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || '';
  const code = params.code || '';

  // OAuth callback — called from oauth.html with ?action=oauth_callback&code=...
  if (action === 'oauth_callback' && code) {
    return handleOAuthCallback(e);
  }

  // Also handle direct redirect from Google with ?code=... (fallback)
  if (code && !action) {
    return handleOAuthCallback(e);
  }

  // Get busy slots
  if (action === 'freebusy') {
    return getFreebusy(e);
  }

  // Health check
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Nails Studio Calendar API' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'create_event') return createCalendarEvent(body);
    return jsonResponse({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function handleOAuthCallback(e) {
  const code = e.parameter.code;
  if (!code) {
    return HtmlService.createHtmlOutput('<h2>❌ pas de code OAuth</h2><pre>' + JSON.stringify(e.parameter) + '</pre>');
  }
  try {
    const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      muteHttpExceptions: true,
      payload: {
        code: code,
        client_id: CLIENT_ID,
        client_secret: getClientSecret(),
        redirect_uri: SCRIPT_URL,
        grant_type: 'authorization_code'
      }
    });
    const responseText = tokenResponse.getContentText();
    Logger.log('Token exchange: ' + responseText);
    const tokens = JSON.parse(responseText);
    if (tokens.error) {
      return HtmlService.createHtmlOutput(
        '<h2>❌ ' + tokens.error + '</h2><p>' + (tokens.error_description||'') + '</p><p>redirect_uri: ' + SCRIPT_URL + '</p>'
      );
    }
    const props = PropertiesService.getScriptProperties();
    props.setProperty('REFRESH_TOKEN', tokens.refresh_token || '');
    props.setProperty('ACCESS_TOKEN', tokens.access_token || '');
    props.setProperty('TOKEN_EXPIRY', String(Date.now() + ((tokens.expires_in||3600) - 300) * 1000));
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:sans-serif;text-align:center;padding:40px">' +
      '<h2>✅ מחובר לגוגל קלנדר!</h2><p>ניתן לסגור חלון זה</p></body></html>'
    );
  } catch (err) {
    Logger.log('Error: ' + err.toString());
    return HtmlService.createHtmlOutput('<h2>❌ ' + err.toString() + '</h2>');
  }
}

function getValidAccessToken() {
  const props = PropertiesService.getScriptProperties();
  const refreshToken = props.getProperty('REFRESH_TOKEN');
  const accessToken = props.getProperty('ACCESS_TOKEN');
  const expiry = parseInt(props.getProperty('TOKEN_EXPIRY') || '0');
  if (accessToken && Date.now() < expiry) return accessToken;
  if (!refreshToken) throw new Error('NOT_CONNECTED');
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    muteHttpExceptions: true,
    payload: {
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: getClientSecret(),
      grant_type: 'refresh_token'
    }
  });
  const tokens = JSON.parse(response.getContentText());
  if (tokens.error) throw new Error('REFRESH_FAILED: ' + tokens.error);
  props.setProperty('ACCESS_TOKEN', tokens.access_token);
  props.setProperty('TOKEN_EXPIRY', String(Date.now() + ((tokens.expires_in||3600) - 300) * 1000));
  return tokens.access_token;
}

function getClientSecret() {
  const secret = PropertiesService.getScriptProperties().getProperty('CLIENT_SECRET');
  if (!secret) throw new Error('CLIENT_SECRET not set');
  return secret;
}

function getFreebusy(e) {
  try {
    const token = getValidAccessToken();
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 1).toISOString();
    const response = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ timeMin: timeMin, timeMax: timeMax, items: [{ id: 'primary' }] })
    });
    const data = JSON.parse(response.getContentText());
    const busy = (data.calendars && data.calendars.primary && data.calendars.primary.busy) || [];
    const byDate = {};
    busy.forEach(function(slot) {
      const dateStr = slot.start.split('T')[0];
      if (!byDate[dateStr]) byDate[dateStr] = [];
      byDate[dateStr].push({ start: slot.start, end: slot.end });
    });
    return jsonResponse({ status: 'ok', busy: byDate });
  } catch (err) {
    if (err.message === 'NOT_CONNECTED') return jsonResponse({ status: 'not_connected' });
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function createCalendarEvent(body) {
  try {
    const token = getValidAccessToken();
    const response = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify(body.event)
    });
    const created = JSON.parse(response.getContentText());
    return jsonResponse({ status: 'ok', eventId: created.id });
  } catch (err) {
    if (err.message === 'NOT_CONNECTED') return jsonResponse({ status: 'not_connected' });
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function getAuthUrl() {
  const state = Utilities.base64Encode(JSON.stringify({ ts: Date.now() }));
  return 'https://accounts.google.com/o/oauth2/v2/auth?' +
    'client_id=' + CLIENT_ID +
    '&redirect_uri=' + encodeURIComponent(SCRIPT_URL) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent(SCOPES) +
    '&access_type=offline' +
    '&prompt=consent' +
    '&login_hint=linoyelkaim%40gmail.com' +
    '&state=' + encodeURIComponent(state);
}

function checkStoredTokens() {
  const props = PropertiesService.getScriptProperties();
  Logger.log('REFRESH_TOKEN: ' + props.getProperty('REFRESH_TOKEN'));
  Logger.log('ACCESS_TOKEN exists: ' + !!props.getProperty('ACCESS_TOKEN'));
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
