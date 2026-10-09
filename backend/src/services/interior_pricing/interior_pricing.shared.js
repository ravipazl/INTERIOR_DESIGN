export const interiorPricingPath = 'interiorpricing'

export const interiorPricingMethods = ['find', 'get', 'create', 'patch', 'remove']

export const interiorPricingClient = (client) => {
  const connection = client.get('connection')

  client.use(interiorPricingPath, connection.service(interiorPricingPath), {
    methods: interiorPricingMethods
  })
}
