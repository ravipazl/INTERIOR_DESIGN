export const generateBoqServicePath = 'generateboq'

export const generateBoqServiceMethods = ['find', 'get', 'create', 'patch', 'remove']

export const generateBoqServiceClient = (client) => {
  const connection = client.get('connection')

  client.use(generateBoqServicePath, connection.service(generateBoqServicePath), {
    methods: generateBoqServiceMethods
  })
}
