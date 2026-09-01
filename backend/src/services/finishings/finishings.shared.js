export const finishingPath = 'finishings'

export const finishingMethods = ['find', 'get', 'create', 'patch', 'remove']

export const finishingClient = (client) => {
  const connection = client.get('connection')

  client.use(finishingPath, connection.service(finishingPath), {
    methods: finishingMethods
  })
}
