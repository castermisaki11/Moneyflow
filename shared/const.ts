export const COOKIE_NAME = "app_session_id";
export const REFRESH_COOKIE_NAME = "app_refresh_token";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const SEVEN_DAYS_MS = 1000 * 60 * 60 * 24 * 7;
export const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

/**
 * Where a user lands right after a successful login. Uses a `?tab=` deep-link
 * so the main app shell opens directly on the requested tab (the app has no
 * dedicated route per tab — they live inside "/"). Change here to retarget
 * post-login (e.g. "/" for the dashboard, "/?tab=account" for the account page).
 */
export const POST_LOGIN_ROUTE = "/?tab=account";
