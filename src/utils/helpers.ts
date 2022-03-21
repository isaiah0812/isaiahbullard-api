export const printJSON = (jsonObject: any) => {
  return JSON.stringify(jsonObject, (key, value) => 
    typeof value === 'bigint'
      ? Number.parseInt(value.toString())
      : value, 2)
}
