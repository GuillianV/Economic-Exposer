export function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function timestampParser(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const milliseconds = date.getMilliseconds();
  const timezoneOffset = date.getTimezoneOffset();

  const yearUtc = date.getUTCFullYear();
  const monthUtc = date.getUTCMonth() + 1;
  const dayUtc = date.getUTCDate();
  const hoursUtc = date.getUTCHours();
  const minutesUtc = date.getUTCMinutes();
  const secondsUtc = date.getUTCSeconds();
  const millisecondsUtc = date.getUTCMilliseconds();
  const timezoneOffsetUtc = date.getTimezoneOffset();

  return {
    actual: {
      year,
      month,
      day,
      hours,
      minutes,
      seconds,
      milliseconds,
      timezoneOffset,
      "yyyy-MM-dd": `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
    },
    utc: {
      year: yearUtc,
      month: monthUtc,
      day: dayUtc,
      hours: hoursUtc,
      minutes: minutesUtc,
      seconds: secondsUtc,
      milliseconds: millisecondsUtc,
      timezoneOffset: timezoneOffsetUtc,
      "yyyy-MM-dd": `${yearUtc}-${monthUtc.toString().padStart(2, "0")}-${dayUtc.toString().padStart(2, "0")}`,
    },
  };
}

export function formatTimestamp(timestamp) {
  if (typeof timestamp !== "string") timestamp = timestamp.toString();
  const timestampLength = timestamp.length;
  if (timestampLength == 16) timestamp = timestamp.slice(0,13);
  if (timestampLength == 10) timestamp = timestamp.padEnd(13, "0");
  return parseInt(timestamp);
}
