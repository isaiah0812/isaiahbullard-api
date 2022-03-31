export const printJSON = (jsonObject: any) => {
  return JSON.stringify(jsonObject, (key, value) => 
    typeof value === 'bigint'
      ? Number.parseInt(value.toString())
      : value, 2)
}

export const NON_ID_CHARACTER_REGEX = /[\x21-\x2C\x2E-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/gi;

export const ID_REGEX = /^[a-z0-9-]*$/gi;
