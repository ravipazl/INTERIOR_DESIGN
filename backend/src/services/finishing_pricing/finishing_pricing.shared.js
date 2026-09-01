export const finishingPricingPath = 'finishingpricing'

export const finishingPricingMethods = ['find', 'get', 'create', 'patch', 'remove']

export const finishingPricingClient = (client) => {
  const connection = client.get('connection')

  client.use(finishingPricingPath, connection.service(finishingPricingPath), {
    methods: finishingPricingMethods
  })
}
