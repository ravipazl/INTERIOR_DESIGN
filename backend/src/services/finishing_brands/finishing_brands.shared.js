export const finishingBrandPath = 'finishingbrands'

export const finishingBrandMethods = ['find', 'get', 'create', 'patch', 'remove']

export const finishingBrandClient = (client) => {
  const connection = client.get('connection')

  client.use(finishingBrandPath, connection.service(finishingBrandPath), {
    methods: finishingBrandMethods
  })
}
