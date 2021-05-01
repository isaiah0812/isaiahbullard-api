require('dotenv').config()

const express = require('express')
const app = express()
const port = 8080

const MongoClient = require('mongodb')

const url = `mongodb://${process.env.MONGO_URL}`

console.log(`Connecting to MongoDB at ${url}`)
MongoClient.connect(url, { useUnifiedTopology: true }, (err, client) => {
  if(err) throw err

  // DB Set-up
  const db = client.db('ibdb')

  // Collection Set-up
  console.log("Getting 'beats' collection...")
  db.collection('beats', (beatsError, beats) => {
    if(beatsError) throw beatsError
    if(beats) console.log("'beats' collection retrieved")

    console.log("Getting 'credits' collection...")
    db.collection('credits', (creditsError, credits) => {
      if(creditsError) throw creditsError
      if(credits) console.log("'credits' collection retrieved")

      console.log("Getting 'merch' collection...")
      db.collection('merch', (merchError, merch) => {
        if(merchError) throw merchError
        if(merch) console.log("'merch' collection retrieved")

        console.log("Getting 'projects' collection...")
        db.collection('projects', (projectsError, projects) => {
          if(projectsError) throw projectsError
          if(projects) console.log("'projects' collection retrieved")

          console.log("Getting 'singles' collection...")
          db.collection('singles', (singlesError, singles) => {
            if(singlesError) throw singlesError
            if(singles) console.log("'singles' collection retrieved")

            console.log("Getting 'videos' collection...")
            db.collection('videos', (videosError, videos) => {
              if(videosError) throw videosError
              if(videos) console.log("'videos' collection retrieved")

              // Dead home path
              app.use('/', (req, res, next) => {
                next()
              })
              
              // Proper path handling
              // Beats
              app.route('/beats')
                .get((req, res) => {
                  beats.find().toArray((error, result) => {
                    if(error) throw error

                    res.setHeader('Access-Control-Allow-Origin', "*")
                    res.json(result)
                  })
                })
              
              // Credits
              app.route('/credits')
                .get((req, res) => {
                  credits.find().toArray((error, result) => {
                    if(error) throw error

                    res.setHeader('Access-Control-Allow-Origin', "*")
                    res.json(result)
                  })
                })

              // Merchandise
              app.route('/merch')
                .get((req, res) => {
                  merch.find().toArray((error, result) => {
                    if(error) throw error

                    res.setHeader('Access-Control-Allow-Origin', "*")
                    res.json(result)
                  })
                })
              
              // Projects
              app.route('/projects')
                .get((req, res) => {
                  const beatTape = req.query.beatTape // beatTape query parameter
                  switch(beatTape) {
                    // Return only Beat Tapes
                    case 'true': 
                      projects.find({ beatTape: true }).toArray((error, result) => {
                        if(error) throw error
                
                        res.setHeader('Access-Control-Allow-Origin', "*")
                        res.json(result)
                      })
                      break;
                    // Return only Albums
                    case 'false': 
                      projects.find({ beatTape: false }).toArray((error, result) => {
                        if(error) throw error
                
                        res.setHeader('Access-Control-Allow-Origin', "*")
                        res.json(result)
                      })
                      break;
                    // Return all Projects
                    default: 
                      projects.find().toArray((error, result) => {
                        if(error) throw error
                
                        res.setHeader('Access-Control-Allow-Origin', "*")
                        res.json(result)
                      })
                      break;
                  }
                })
              
              // Singles
              app.route('/singles')
                .get((req, res) => {
                  singles.find().toArray((error, result) => {
                    if(error) throw error

                    res.setHeader('Access-Control-Allow-Origin', "*")
                    res.json(result)
                  })
                })

              // Videos
              app.route('/videos')
                .get((req, res) => {
                  videos.find().toArray((error, result) => {
                    if(error) throw error

                    res.setHeader('Access-Control-Allow-Origin', "*")
                    res.json(result)
                  })
                })
              
              // Listener
              app.listen(port, () => {
                console.log(`The ZaePI is listening on port ${port}!`)
              })
            })
          })
        })
      })
    })
  })
})