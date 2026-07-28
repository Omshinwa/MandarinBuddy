## OLD WEBSITE (hosted on render)

uses
render.com (cloud website hosting service)
and
MongoDB Atlas (for database, render.com doesnt allow)

## HOW TO RUN THE WEBSITE LOCALLY:
1. export the ATLAS_URI variable.
2. `npm start`

export ATLAS_URI="mongodb+srv://omshinwa:Mdpdemo20.@cluster0.5yn9ctw.mongodb.net/test?retryWrites=true&w=majority"
npm start
open http://localhost:5001/

`test` in the ATLAS_URI_URI is the database name 

## TODO

password / protect data
automatically back up the list of words somewhere?



## NEW APP

launch the server
cd v2/server && npm run dev
launch the app
cd v2/app && npm start

### server: `npm run dev` vs `npm start`
- `npm run dev` = `tsx watch` — auto-restarts when you edit server code. use this while developing.
- `npm start` = `tsx` (no watch) — loads the code once and holds it in memory. if you edit server code you MUST ctrl-c and relaunch, or the running process keeps serving the OLD code (this once caused Hard/Easy grades to fail with "bad grade").
- either way, `.env` (e.g. MONGODB_URI) is read only at boot — changing it needs a manual restart.

the app (`cd v2/app && npm start`, expo) has Fast Refresh, so client code hot-reloads on save; F5 the browser if a change doesn't show.

## TEST ON PHONE
Install **Expo Go** from the App Store / Play Store, then run `cd v2/app && npm start` and scan the QR code with your phone (same Wi-Fi as your Mac). 