JARVIS AI V1
=============

ARCHITECTURE
------------
Frontend (GitHub Pages) : index.html, style.css, app.js, sw.js, manifest.webmanifest, icons/
Backend  (Render)       : server.js, package.json, package-lock.json
AI providers            : Groq (primary) -> Gemini (fallback)
Chat history            : saved on the user's device (localStorage), no database.

SETUP INSTRUCTIONS
------------------
(Firebase is no longer used.)

3. Render Backend Setup
   - render.com par new Web Service banayein.
   - GitHub repo connect karein: Shashwat0213/Jarvis
   - Settings:
       Root Directory : (khaali)
       Build Command  : npm install
       Start Command  : npm start
       Runtime        : Node
       Instance Type  : Free
   - Environment tab mein add karein:
       GROQ_API_KEY   = Groq key (console.groq.com)
       GEMINI_API_KEY = Gemini key (aistudio.google.com/apikey)
       (optional) GEMINI_MODELS = gemini-2.5-flash,gemini-2.5-flash-lite
       (optional) EXTRA_ORIGINS = https://your-other-site.com
   - Deploy karein.

4. Frontend Update
   - Render deploy hone ke baad URL copy karein.
   - app.js mein JARVIS_BACKEND line update karein.
   - GitHub par commit karein.

5. Cold Start Notice (Free Tier)
   - Render free tier 15 min inactivity ke baad sleep ho jata hai.
   - First request 30-60 seconds le sakti hai.
   - Permanent fix ke liye cron-job.org se har 5 min ping karwayein.

SECURITY NOTES
--------------

* Firebase API key (jo app.js mein hai) PUBLIC rakhna SAFE hai.
  Ye project identifier hai, koi password nahi.
  Asli security Firestore Rules aur Auth settings se aati hai.

* Gemini API key KABHI app.js ya frontend code mein na rakhein.
  Ye sirf server par (Render environment variables) rehni chahiye.

* Agar kabhi galti se Gemini key public ho jaye:
  1. aistudio.google.com/apikey par jaayein.
  2. Us key ko turant revoke karein.
  3. Nayi key banayein.
  4. Nayi key sirf Render environment mein daalein.

* Firestore Rules hamesha authentication-based rakhein.

* Render par CORS allowed origins hamesha restrict rakhein.

FILES
-----

Frontend : index.html, style.css, app.js
Backend  : server.js, package.json, package-lock.json
Docs     : README.txt

NOTES
-----

- Alexa integration nahi hai.
- ChatGPT integration future mein aayega.
- Gemini abhi main AI brain hai.
- Voice recognition Chrome/Edge mein sabse acche se kaam karta hai.

Powered by SHASHWAT

PWA / INSTALL
-------------
- Open the GitHub Pages URL in Chrome/Edge (Android, desktop): "Install app" button appears in the header.
- iPhone: Safari > Share > Add to Home Screen (button shows these steps).
- After changing frontend files, bump CACHE in sw.js ("jarvis-v2" -> "jarvis-v3") so installed apps update.
