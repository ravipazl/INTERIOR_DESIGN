export const aiGeneratorServicePath = 'generator'

export const aiGeneratorServiceMethods = ['find', 'get', 'create', 'patch', 'remove']

export const aiGeneratorServiceClient = (client) => {
  const connection = client.get('connection')

  client.use(aiGeneratorServicePath, connection.service(aiGeneratorServicePath), {
    methods: aiGeneratorServiceMethods
  })
}
