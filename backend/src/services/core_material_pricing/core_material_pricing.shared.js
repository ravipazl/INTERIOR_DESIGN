export const coreMaterialPricingPath = 'corematerialpricing'

export const coreMaterialPricingMethods = ['find', 'get', 'create', 'patch', 'remove']

export const coreMaterialPricingClient = (client) => {
  const connection = client.get('connection')

  client.use(coreMaterialPricingPath, connection.service(coreMaterialPricingPath), {
    methods: coreMaterialPricingMethods
  })
}
