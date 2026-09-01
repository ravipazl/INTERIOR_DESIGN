export const imagePath = 'images'

export const imageMethods = ['find', 'get', 'create', 'patch', 'remove']

export const imageClient = (client) => {
  const connection = client.get('connection')

  client.use(imagePath, connection.service(imagePath), {
    methods: imageMethods
  })
}
