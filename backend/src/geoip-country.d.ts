declare module "geoip-country" {
  type Lookup = {
    country?: string
    name?: string
  }

  function lookup(ip: string): Lookup | null

  const geoip: {
    lookup: typeof lookup
  }

  export default geoip
}
