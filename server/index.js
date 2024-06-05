const users = require("./users.js")
const files = require("./files.js")
const fs = require("fs")
const express = require("express")
const ejs = require("ejs")
const { print } = require("./utils.js")
const fb = require("./firebase.js")
const path = require("path")
require("dotenv").config()
const cookieparser = require("cookie-parser")
// const cors = require("cors")

const app = express()
const PORT = process.env.PORT || 3000
const cookie_settings = {
   httpOnly: true,
   secure: false, // prod change to true
   sameSite: "Strict",
   maxAge: users.TOKEN_EXPIRATION_TIME,
}

let current_event = "1717362314700_anothertest"
let events = {}
let events_list = []

// app.use(cors({
//    origin: "http://localhost:5173",
//    credentials: true,
// }))
app.use(express.json())
app.use(cookieparser())
// app.use(express.static(__dirname + "/public"))

app.use(express.static(path.join(__dirname, "dist")))
app.get("/", (req, res) => {
   res.sendFile(path.join(__dirname, "/dist/index.html"))
})

// app.get("/upload", users.authenticate_token, (req, res) => {
//    res.render("upload")
// })

// app.get("/login", (req, res) => {
//    res.render("login")
// })

app.post("/api/eventcreate", users.authenticate_token_admin, (req, res) => {
   current_event = `${Date.now()}_${req.body.id}`
   const date = Date.now()
   const name = req.body.name
   const desc = req.body.desc
   fb.set_doc("events", current_event, {
      date,
      name,
      desc,
      tracks: []
   })
   return res.status(200)
})

// update user name
app.post("/api/update_displayname", users.authenticate_token, async (req, res) => {
   const newname = req.body.display_name

   // todo make validation function
   if (!newname || newname.length == 0 || newname.length > 30) return res.status(400).send({ message: "Invalid name" })

   await fb.update_doc("users", req.username, { display_name: newname })

   res.status(200).send({ message: "Updated display name" })
})

app.post("/api/update_bio", users.authenticate_token, async (req, res) => {
   const bio = req.body.bio

   // todo make validation function
   if (!bio || bio.length == 0 || bio.length > 300) return res.status(400).send({ message: "Invalid bio" })

   await fb.update_doc("users", req.username, { bio: bio })

   res.status(200).send({ message: "Updated biography" })
})

app.post("/api/update_icon", users.authenticate_token, files.upload.single("icon"), async (req, res) => {
   if (!req.file) return res.status(400).send({ message: "Submit an icon" })
   const icon = req.file

   if (!/\.webp$/i.test(icon.originalname)) {
      return res.status(400).send({ message: "Must be a valid webp image" })
   }
   // validate picture size
   if (icon.buffer.length / 1024 > files.MAX_ICON_SIZE_KB) {
      return res.status(400).send({ message: "Profile icon file is too big (exceeds " + Math.floor(files.MAX_ICON_SIZE_KB)+ "kb limit)" })
   }

   // delete old icon
   let split_names = (await fb.get_doc("users", req.username)).icon.split("/")
   let old_icon_name = split_names[split_names.length - 1]
   await files.delete_file(old_icon_name, files.profiles_bucket) 

   const iconfile = await files.upload_file(icon, files.profiles_bucket)
   let iconlink = files.get_gcloud_link(iconfile, files.profiles_bucket_name)

   await fb.update_doc("users", req.username, { icon: iconlink })

   res.status(200).send({ message: "Updated icon" })
})

// requires authenticated user
// takes a payload of at least 1 (track) file, up to 2 (second is album) files
// and a string title
// validates files then uploads to storage & sets in db
app.post("/api/upload", users.authenticate_token, files.upload.fields([
      { name: "track" },
      { name: "album", maxCount: 1 }
   ]), async (req, res) => {
      // make sure server is pointed at a new event
      if (current_event == undefined || current_event == "") {
         return res.status(400).send({ message: "No event is open" })
      }

      try {
         // first check if we have user perms to upload tracks
         // it is USER_NORMAL
         if (req.username == undefined || req.username == "") {
            return res.status(400).send({ message: "Invalid token" })
         }

         let user_data = await fb.get_doc("users", req.username)
         if (!user_data) return res.status(400).send({ message: "Invalid user" })
         if (user_data.permissions < users.USER_NORMAL) {
            return res.status(400).send({ message: "Invalid user permissions" })
         }

         // get & validate our data
         const artist = user_data.username // important: user USERNAME! this is used to recall a display name later
         const title = req.body.title
         const lyrics = req.body.lyrics ? req.body.lyrics : ""

         if (artist == undefined || title == undefined || artist.length == 0 || title.length == 0) {
            return res.status(400).send({ message: "Invalid artist/title" })
         }

         const userfiles = req.files
         
         if (!userfiles.track) {
            return res.status(400).send({ message: "Upload a file" })
         }

         // track file is required. album optional
         const trackfile = userfiles.track[0]
         const albumfile = userfiles.album ? userfiles.album[0] : undefined
         if (albumfile && !/\.webp$/i.test(albumfile.originalname)) {
            return res.status(400).send({ message: "Must be a valid webp image" })
         }

         // validate file sizes
         if (trackfile.buffer.length / 1024 > files.MAX_TRACK_SIZE_KB) {
            return res.status(400).send({ message: "Track file is too big (exceeds " + Math.floor(files.MAX_TRACK_SIZE_KB / 1024) + "mb limit)" })
         }
         if (albumfile && albumfile.buffer.length / 1024 > files.MAX_ALBUM_SIZE_KB) {
            return res.status(400).send({ message: "Album file is too big (exceeds " + Math.floor(files.MAX_ALBUM_SIZE_KB)+ "kb limit)" })
         }

         let filename = await files.upload_file(trackfile, files.tracks_bucket)
         let url = files.get_gcloud_link(filename, files.tracks_bucket_name)
         let album
         if (albumfile) album = files.get_gcloud_link(await files.upload_file(albumfile, files.albums_bucket), files.albums_bucket_name)
         else album = files.get_gcloud_link("default.webp", files.albums_bucket_name)

         // save entry into database
         const newentry = {
            artist,
            title,
            lyrics,
            filename,
            url,
            album,
            plays: 0,
            winner: false
         }

         // save track to db
         fb.set_doc("tracks", filename, newentry)
         // save track to current event
         fb.update_doc("events", current_event, {
            tracks: fb.FieldValue.arrayUnion(filename)
         })

         res.status(200).send({ message: "Successfully uploaded" })
      } catch (err) {
         throw err
         print("Error uploading file: " + err)
         res.status(400).send({ message: "Error uploading file" })
      }
   })

app.post("/api/login", files.upload.none(), async (req, res) => {
   try {
      const username = req.body.username 
      const password = req.body.password

      // validate packet
      if (username == undefined || password == undefined || username == "" || password == "") {
         return res.status(400).send({ message: "Invalid request" })
      }
      
      // authenticate user (returns -1 on error)
      const token = await users.login_user(username, password)
      if (token < 0) {
         return res.status(400).send({ message: "Invalid username/password combination" })
      }

      // get user data to return to user
      let userdata = await fb.get_doc("users", username)
      if (userdata == undefined) {
         return res.status(400).send({ message: "Invalid account: user data doesn't exist" })
      }

      // save cookie w client
      res.cookie("authentication_token", token, cookie_settings)
      res.status(200).send({ message: "Login successful", user: userdata })
   } catch (err) {
      res.status(500).send({ message: "Unable to login" })
      print(err)
   }
})

app.post("/api/signup", files.upload.fields([
      { name: "icon", maxCount: 1 }
   ]), async (req, res) => {
   try {
      const user = {
         username: req.body.username,
         password: req.body.password,
         bio: req.body.bio ? req.body.bio : "This user doesn't have a bio",
      }

      // validate packet
      if (user.username == undefined || user.password == undefined || user.username == "" || user.password == "" ||
         user.username.includes(" ") || user.username.length > 30) {
         return res.status(400).send({ message: "Invalid request" })
      }

      // check if username exists
      if ((await fb.get_doc("passwords", user.username)) != undefined) {
         return res.status(400).send({ message: "Username is taken" })
      }

      // upload profile picture if there
      const icon = req.files.icon ? req.files.icon[0] : undefined
      if (icon) {
            console.log("detected image")
         if (!/\.webp$/i.test(icon.originalname)) {
            return res.status(400).send({ message: "Must be a valid webp image" })
         }
         // validate picture size
         if (icon.buffer.length / 1024 > files.MAX_ICON_SIZE_KB) {
            return res.status(400).send({ message: "Profile icon file is too big (exceeds " + Math.floor(files.MAX_ICON_SIZE_KB)+ "kb limit)" })
         }

         const iconfile = await files.upload_file(icon, files.profiles_bucket)
         user.icon = files.get_gcloud_link(iconfile, files.profiles_bucket_name)
      } else {
         user.icon = files.get_gcloud_link("default_icon.webp", files.profiles_bucket_name)
      }

      // get & save token
      const token = await users.create_new_user(user, users.USER_NORMAL)
      let newuser = await fb.get_doc("users", user.username)

      res.cookie("authentication_token", token, cookie_settings)
      res.status(200).json({ message: "Account created successfully!", user: newuser })
   } catch (err) {
      res.status(500).json({ message: "Failed to create account.", error: err })
      print(err)
   }
})

app.post("/api/logout", (req, res) => {
   const token = req.cookies.authentication_token
   if (!token) {
      return res.status(201).send({ message: "No need to sign out" })
   }
   res.clearCookie("authentication_token")
   res.status(200).send({ message: "Signed out successfully" })
})

app.post("/api/user", async (req, res) => {

   if (req.body.username == undefined) {
      return res.status(400).send({ message: "Requires 'username' in request body" })
   }

   let userdata = await fb.get_doc("users", req.body.username)
   if (userdata) {
      res.status(200).send({ message: "Found user data", user: userdata })
   } else {
      res.status(400).send({ message: "Invalid username", user: undefined })
   }
})

app.get("/api/userbytoken", async (req, res) => {
   const token = req.cookies.authentication_token

   if (!token) return res.status(201).send({ message: "no token"})
   const user = await users.check_token(token) // returns false on invalid, userdata on valid

   if (user) {
      let userdata = await fb.get_doc("users", user.username)
      res.status(200).send({ message: "Found user data", user: userdata })
   } else {
      res.status(201).send({ message: "Invalid or unprovided token", user: undefined })
   }
})

app.get("/api/events", async (req, res) => {
   res.json({
      events: events_list
   })
})

app.post("/api/tracks", async (req, res) => {
   if (req.body.username == undefined) {
      return res.status(400).send({ message: "Invalid username" })
   }

   let tracks = await fb.get_docs_by_query("tracks", [ "artist", "==", req.body.username ])
   for (let i = 0; i < tracks.length; i++) {
      tracks[i].artist_display_name = (await fb.get_doc("users", tracks[i].artist)).display_name
   }
   res.status(200).send({ message: "Found user tracks", tracks: tracks })
})

app.listen(PORT, () => {
   // listen for updates in collections
   fb.setup_collection_listener("events", async (e) => {
      let keys = Object.keys(e)
      for (let i = 0; i < keys.length; i++) {
         let event = e[keys[i]]
         let track_ids = event.tracks
         event.tracks = []

         for (let j = 0; j < track_ids.length; j++) {
            // events store tracks as a list of ids
            // use IDs to get track data
            // inside each track, use artist USERNAME to get their DISPLAY name
            let track = await fb.get_doc("tracks", track_ids[j])
            track.artist_display_name = (await fb.get_doc("users", track.artist)).display_name
            event.tracks.push(track)
         }
         events[keys[i]] = event
      }

      events_list = Array.from(Object.values(events))
      events_list.reverse()
   })

   print("started on port " + PORT)
})
