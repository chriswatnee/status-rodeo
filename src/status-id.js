// The id in a status address (/statuses/42). Only plain positive whole numbers
// without leading zeros are accepted, so each status has exactly one address.
// The length cap keeps the number exact as a JavaScript number (statuses.id is a
// bigint in Postgres, but a real id will never come close to 15 digits). Returns
// the id as a number, or null if the text is not a status id, in which case no
// request is needed: the page is simply "not found".
export function parseStatusId(text) {
  if (typeof text !== 'string' || !/^[1-9][0-9]{0,14}$/.test(text)) return null;

  return Number(text);
}
