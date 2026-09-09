// scripts/create-admin.js
//
// Bootstrap the admin account. Run it with NO arguments and it asks for the
// email and password one at a time:
//
//   node scripts/create-admin.js
//     Email:    admin@pazl.info
//     Password: ********
//
// It always creates an "admin". If the email already exists the script stops
// and changes nothing.
//
// How it works:
//   - Loads the existing Feathers app, so it uses the same DB and the same
//     password-hashing resolver as the real /users endpoint.
//   - Runs as a trusted internal call (no HTTP provider), so the role it sets is
//     honoured — external HTTP requests still cannot self-assign a role.
//
// IMPORTANT — why `../src/app.js` is imported DYNAMICALLY, below, instead of at
// the top of this file:
//
// ESM evaluates every static import before the module body runs. Importing the
// app up here therefore booted Feathers *before* the first prompt was printed,
// so its startup output ("[objaverse] loaded index…", the channels warning) and
// Node's punycode DeprecationWarning landed on top of the "Email:" line:
//
//     Email:    (node:29456) [DEP0040] DeprecationWarning: The `punycode` …
//
// The prompt was still waiting for input, but it looked like the script had
// crashed. Prompting first, then loading the app, keeps the two apart.
import readline from 'readline'

// Set before the app (and its dependency chain) is loaded, so the punycode
// DeprecationWarning above is never emitted. Node checks this flag at emit time.
process.noDeprecation = true

const ROLE = 'admin'

function ask(rl, query) {
  return new Promise((resolve) => rl.question(query, (answer) => resolve((answer || '').trim())))
}

// Same as ask(), but the typed characters are not echoed to the terminal.
// readline writes each keystroke through `_writeToOutput`; muting it only AFTER
// rl.question() has printed the query keeps the label visible and hides the
// answer.
//
// Only attempted on a real terminal: piped stdin echoes nothing to hide, and
// this reaches into a readline internal, so there is no reason to risk it when
// there is no benefit. Falls back to a normal visible prompt either way.
function askSecret(rl, query) {
  if (!process.stdin.isTTY || typeof rl._writeToOutput !== 'function') return ask(rl, query)
  return new Promise((resolve) => {
    const original = rl._writeToOutput
    let muted = false
    rl._writeToOutput = function (chunk) {
      if (!muted) original.call(rl, chunk)
    }
    rl.question(query, (answer) => {
      rl._writeToOutput = original
      rl.output.write('\n') // the muted Enter never produced one
      resolve((answer || '').trim())
    })
    muted = true
  })
}

async function run() {
  // Interactive by default. Email / password may also be passed as args for
  // automation:  node scripts/create-admin.js <email> <password>
  const [, , argEmail, argPassword] = process.argv
  const interactive = !argEmail || argPassword == null

  let email, password
  if (interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    email = argEmail ? argEmail.trim() : await ask(rl, 'Email:    ')
    password = argPassword != null ? argPassword : await askSecret(rl, 'Password: ')
    rl.close()
  } else {
    email = argEmail.trim()
    password = argPassword
  }

  if (!email) {
    console.error('\nEmail is required.\n')
    process.exit(1)
  }
  if (!password) {
    console.error('\nPassword is required.\n')
    process.exit(1)
  }

  // Loaded only now — see the note at the top of this file.
  console.log('\nConnecting…')
  const { app } = await import('../src/app.js')

  // Boots services + the MongoDB connection WITHOUT starting an HTTP server.
  await app.setup()
  const users = app.service('users')

  const closeDb = async () => {
    const mongoClient = await app.get('mongodbClient')
    if (mongoClient?.client?.close) await mongoClient.client.close()
  }

  const existing = await users.find({ query: { email, $limit: 1 }, paginate: false })
  const existingUser = Array.isArray(existing) ? existing[0] : existing?.data?.[0]

  if (existingUser) {
    // Validation: this email is already registered — do not create or change it.
    console.error(`\nUser already exists: ${email} (role: ${existingUser.permissions}).`)
    console.error('No account was created.\n')
    await closeDb()
    process.exit(1)
  }

  // The password resolver in users.schema.js bcrypt-hashes `password`.
  const created = await users.create({ email, password, name: 'Admin', permissions: ROLE })
  console.log(`\nCreated new "${ROLE}" account:`)
  console.log({ email: created.email, permissions: created.permissions })

  await closeDb()
  process.exit(0)
}

run().catch((err) => {
  console.error('\nFailed to create admin:')
  console.error(err)
  process.exit(1)
})
