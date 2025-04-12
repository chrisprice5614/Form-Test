require("dotenv").config() // Makes it so we can access .env file
const sanitizeHTML = require("sanitize-html")//npm install sanitize-html
const jwt = require("jsonwebtoken")//npm install jsonwebtoken doten
const bcrypt = require("bcrypt") //npm install bcrypt
const cookieParser = require("cookie-parser")//npm install cookie-parser
const express = require("express")
const db = require("better-sqlite3")("ourApp.db") //npm install better-sqlite3
db.pragma("journal_mode = WAL") //Makes it faster


//database setup here
const createTables = db.transaction(() => {
    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username STRING NOT NULL UNIQUE,
        password STRING NOT NULL
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdDate TEXT,
        title STRING NOT NULL,
        content STRING NOT NULL,
        authorid INTEGER NOT NULL,
        FOREIGN KEY (authorid) REFERENCES users (id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        authorid INTEGER NOT NULL,
        postid INTEGER NOT NULL,
        FOREIGN KEY (authorid) REFERENCES users (id),
        FOREIGN KEY (postid) REFERENCES posts (id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        authorid INTEGER NOT NULL,
        postid INTEGER NOT NULL,
        content STRING NOT NULL,
        FOREIGN KEY (authorid) REFERENCES users (id),
        FOREIGN KEY (postid) REFERENCES posts (id)
        )
        `
    ).run()
})

createTables();

//database setup ends here


const app = express()

app.set("view engine", "ejs")
//Views is the folder they'll look in

app.use(express.urlencoded({extended: false}))// This makes it so we can easily access requests

app.use(express.static("public")) //Using public folder
app.use(cookieParser())

//Middleware
app.use(function (req, res, next) {
    res.locals.errors = []

    // try to decode incoming cookie
    try {
        const decoded = jwt.verify(req.cookies.ourSimpleApp, process.env.JWTSECRET)
        req.user = decoded
    } catch(err){
        req.user = false
    }

    res.locals.user = req.user
    console.log(req.user)

    next()
})


//Get commands
app.get("/", (req,res) => {
    //res.send("Hello world from our cool app :)")
    if(req.user) {

        const allPostsStatement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id ORDER BY createdDate DESC")
        const allPosts = allPostsStatement.all() // .all is like .get, but it gets all isntead

        const commentStatement = db.prepare("SELECT * FROM comments")
        const comments = commentStatement.all() // .all is like .get, but it gets all isntead

        return res.render("allposts", {allPosts, comments})
    }
    res.render("homepage")
})


app.get("/dashboard", (req,res) => {
    //res.send("Hello world from our cool app :)")
    if(req.user) {
        const postsStatement = db.prepare("SELECT * FROM posts WHERE authorid = ? ORDER BY createdDate DESC")
        const posts = postsStatement.all(req.user.userid) // .all is like .get, but it gets all isntead


        return res.render("dashboard", {posts})
    }
    res.render("homepage")
})

app.get("/login", (req,res)=> {
    res.render("login")
})

app.get("/logout", (req,res) => {
    res.clearCookie("ourSimpleApp")
    res.redirect("/")
})

app.get("/edit-post/:id", (req,res)=>{
    //Try to look up the post in question
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?")
    const post = statement.get(req.params.id)

    if(!post) {
        return res.redirect("/")
    }

    //If not author go back home
    if(post.authorid!==req.user.userid)
    {
        return res.redirect("/")
    }

    

    //show edit post
    res.render("edit-post", {post})
})

app.post("/edit-post/:id",mustBeLoggedIn, (req, res)=>{
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?")
    const post = statement.get(req.params.id)

    if(!post) {
        return res.redirect("/")
    }

    //If not author go back home
    if(post.authorid!==req.user.userid)
    {
        return res.redirect("/")
    }

    const errors = sharedPostValidation(req)

    if(errors.length)
    {
        return res.render("edit-post",{errors})
    }

    const updateStatement = db.prepare("UPDATE posts SET title = ?, content = ? WHERE id = ?")
    updateStatement.run(req.body.title, req.body.body, req.params.id)

    res.redirect(`/post/${req.params.id}`)


})

app.post("/delete-post/:id", mustBeLoggedIn, (req,res) =>{
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?")
    const post = statement.get(req.params.id)

    if(!post) {
        return res.redirect("/")
    }

    //If not author go back home
    if(post.authorid!==req.user.userid)
    {
        return res.redirect("/")
    }


    //Always setup as statement = prepare, then do statement.run/statement.get, and then the params
    const deleteStatement = db.prepare("DELETE FROM posts WHERE id = ?")
    deleteStatement.run(req.params.id)

    res.redirect("/")
})

app.get("/post/:id", (req,res)=>{
    //select everything from posts (posts.*) then select only username from users (users.username)
    const statement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id WHERE posts.id = ?")
    const post = statement.get(req.params.id)

    if(!post) {
        return res.redirect("/")
    }

    if(!post) {
        return res.redirect("/")
    }

    const commentStatement = db.prepare("SELECT comments.*, posts.id, users.username FROM comments INNER JOIN posts ON comments.postid = posts.id INNER JOIN users ON comments.authorid = users.id WHERE posts.id = ? ORDER BY id DESC")
    const comments = commentStatement.all(req.params.id)

    console.log(comments);

    const isAuthor = post.authorid === req.user.userid

    res.render("single-post", {post,isAuthor,comments})
})


//check for login
function mustBeLoggedIn(req, res, next){
    if(req.user) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

app.get("/create-post",mustBeLoggedIn, (req, res)=>{
    
    res.render("create-post")
})

function sharedPostValidation(req) {
    const errors = []

    if(typeof req.body.title !== "string") req.body.title = ""
    if(typeof req.body.body !== "string") req.body.body = ""

    //trim - sanitize or strip out html
    req.body.title = sanitizeHTML(req.body.title.trim(), {allowedTags: [], allowedAttributes: {}})
    req.body.body = sanitizeHTML(req.body.body.trim(), {allowedTags: [], allowedAttributes: {}})

    if(!req.body.title) errors.push("you must provide a title")
    if(!req.body.body) errors.push("you must provide content")

    return errors
}

app.post("/create-post",mustBeLoggedIn, (req, res)=>{
    const errors = sharedPostValidation(req)

    if(errors.length) {
        return res.render("create-post",{errors})
    }

    // save into database
    const ourStatement = db.prepare("INSERT INTO posts (title,content,authorid, createdDate) VALUES (?,?,?,?)")
    const result = ourStatement.run(req.body.title, req.body.body, req.user.userid, new Date().toISOString())

    const getPostStatement = db.prepare("SELECT * FROM posts WHERE ROWID = ?")
    const realPost = getPostStatement.get(result.lastInsertRowid)

    res.redirect(`/post/${realPost.id}`)
})

//Adding a comment
app.post("/add-comment",mustBeLoggedIn, (req, res)=>{
    const errors = []

    if(typeof req.body.title !== "string") req.body.title = ""

    //trim - sanitize or strip out html
    req.body.title = sanitizeHTML(req.body.title.trim(), {allowedTags: [], allowedAttributes: {}})

    if(!req.body.body) errors.push("you must provide a comment")


    const postId = req.body.postId

    if(errors.length) {
        return res.redirect(`post/${postId}`)
    }

    

    
    // save into database
    const ourStatement = db.prepare("INSERT INTO comments (postid,content,authorid) VALUES (?,?,?)")
    const result = ourStatement.run(postId, req.body.body, req.user.userid)


    res.redirect(`/post/${postId}`)
    
})


//logging in
app.post("/login", (req, res) => {
    let errors = []

    if (typeof req.body.username !== "string") req.body.username = ""
    if (typeof req.body.password !== "string") req.body.password = ""

    req.body.username = req.body.username.trim()

    if(req.body.username == "") errors=["Invalid username/password"]
    if(req.body.password == "") errors=["Invalid username/password"]

    if(errors.length) {
        return res.render("login", {errors}) //returning to the login page while also passing the object "errors"
    }

    const userInQuestionStatement = db.prepare("SELECT * FROM users WHERE USERNAME = ?") //Select *(any) from 'name of table'
    const userInQuestion = userInQuestionStatement.get(req.body.username)

    if(!userInQuestion) {
         errors=["Invalid username/password"]
         return res.render("login", {errors})
    }


    const matchOrNot = bcrypt.compareSync(req.body.password, userInQuestion.password)
    if(!matchOrNot)
    {
        errors=["Invalid username/password"]
        return res.render("login", {errors})
    }

    // log the user in by giving them a cookie
    const ourTokenValue = jwt.sign({exp: Math.floor(Date.now() / 1000) + (60*60*24), userid: userInQuestion.id, username: userInQuestion.username}, process.env.JWTSECRET) //Creating a token for logging in

    res.cookie("ourSimpleApp",ourTokenValue, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24
    }) //name, string to remember,

    //redirection
    res.redirect("/")
})

//Registering
app.post("/register", (req, res) =>{
    const errors = []

    if (typeof req.body.username !== "string") req.body.username = ""
    if (typeof req.body.password !== "string") req.body.password = ""

    req.body.username = req.body.username.trim()

    if(!req.body.username) errors.push("You must provide a username.")
    if(req.body.username && req.body.username.length < 3) errors.push("Your username must have at least 3 characters")
    if(req.body.username && req.body.username.length > 10) errors.push("Your username can have max 10 characters")
    if(req.body.username && !req.body.username.match(/^[a-zA-Z0-9]+$/)) errors.push("Username can only contain letters and numbers.")

    if(!req.body.password) errors.push("You must provide a password.")
    if(req.body.password && req.body.password.length < 6) errors.push("Your password must have at least 3 characters")
    if(req.body.password && req.body.password.length > 20) errors.push("Your password can have max 10 characters")

        //Check if username exists
    const usernameStatement = db.prepare("SELECT * FROM users WHERE username = ?")
    const usernameCheck = usernameStatement.get(req.body.username)

    if(usernameCheck) errors.push("Username is already taken.")

    if(errors.length > 0)
    {
        //if there's an error, we return to the homepage and let them know there's an issue
        return res.render("homepage", {errors})
    }

    
    
    // Save the new user into a database
    const salt = bcrypt.genSaltSync(10)
    req.body.password = bcrypt.hashSync(req.body.password, salt)

    const ourStatement = db.prepare("INSERT INTO users (username, password) VALUES (? , ?)")
    const result = ourStatement.run(req.body.username, req.body.password)

    const lookupStatement = db.prepare("SELECT * FROM users WHERE ROWID = ?")
    const ourUser = lookupStatement.get(result.lastInsertRowid)

    // log the user in by giving them a cookie
    const ourTokenValue = jwt.sign({exp: Math.floor(Date.now() / 1000) + (60*60*24), userid: ourUser.id, username: ourUser.username}, process.env.JWTSECRET) //Creating a token for logging in

    res.cookie("ourSimpleApp",ourTokenValue, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24
    }) //name, string to remember,


    res.redirect("/")
    
})


//What port we're listening on
app.listen(3000)


////npm run dev