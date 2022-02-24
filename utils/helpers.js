const printJSON = (jsonObject) => {
  return JSON.stringify(jsonObject, (key, value) => 
    typeof value === 'bigint'
      ? Number.parseInt(value)
      : value, 2)
}

module.exports = { printJSON };