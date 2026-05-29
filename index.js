const express = require('express')
const app = express()
app.use(express.urlencoded({ extended: false }))

app.get('/', (req, res) => res.send('Adore Salon AI Receptionist is running'))

app.post('/voice', (req, res) => {
  res.type('text/xml')
  res.send(`
    <Response>
      <Say>Hello, thank you for calling Adore Salon. Please hold while we connect you.</Say>
    </Response>
  `)
})

app.listen(8080, () => console.log('Running on port 8080'))
