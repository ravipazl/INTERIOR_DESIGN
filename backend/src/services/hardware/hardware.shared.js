export const hardwarePath = 'hardware'

export const hardwareMethods = ['find', 'get', 'create', 'patch', 'remove']

export const hardwareClient = (client) => {
  const connection = client.get('connection')

  client.use(hardwarePath, connection.service(hardwarePath), {
    methods: hardwareMethods
  })
}
