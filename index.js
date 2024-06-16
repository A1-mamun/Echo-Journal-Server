const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser')
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000;


// middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
    optionsSuccessStatus: 200
}))
app.use(express.json());
app.use(cookieParser())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xrf0qev.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Collections
        const articleCollection = client.db("EchoJournalDB").collection("articles")
        const publisherCollection = client.db("EchoJournalDB").collection("publishers")
        const userCollection = client.db("EchoJournalDB").collection("users")
        // await client.connect();

        // auth related api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '7d' })
            res.send({ token })
        })
        // all articles
        app.get('/articles', async (req, res) => {
            const result = await articleCollection.find().toArray();
            res.send(result)
        })
        // trending articles
        app.get('/articles-trend', async (req, res) => {
            const options = {
                sort: { view: -1 }
            }
            const result = await articleCollection.find({}, options).toArray();
            res.send(result)
        })

        // published articles
        app.get('/approved-articles', async (req, res) => {
            const search = req.query.search;
            const query = {
                status: "Approved",
                title: { $regex: search, $options: 'i' }
            }
            const result = await articleCollection.find(query).toArray();
            res.send(result)
        })

        // premium articles
        app.get('/premium-articles', async (req, res) => {
            const query = {
                access: "premium"
            }
            const result = await articleCollection.find(query).toArray();
            res.send(result)
        })

        // all publisher
        app.get('/publishers', async (req, res) => {
            const result = await publisherCollection.find().toArray()
            res.send(result);
        })

        // article based on id
        app.get('/article/:id', async (req, res) => {
            const query = { _id: new ObjectId(req.params.id) }
            const result = await articleCollection.findOne(query);
            res.send(result)
        })

        // article base on email
        app.get('/my-articles', async (req, res) => {
            let query = {}
            if (req.query?.email) { query = { author_email: req.query.email } }
            const result = await articleCollection.find(query).toArray();
            res.send(result)
        })

        // get all user
        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray()
            res.send(result)
        })

        // get a user info based on email from db
        app.get('/user/:email', async (req, res) => {
            const query = { email: req.params.email }
            const result = await userCollection.findOne(query)
            res.send(result)
        })

        // statistics data
        app.get('/statistics', async (req, res) => {
            const users = await userCollection.estimatedDocumentCount();
            const normalUsers = await userCollection.countDocuments({ isPremium: 'no' });
            const result = await articleCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalView: {
                            $sum: "$view"
                        }
                    }
                }
            ]).toArray()
            const totalView = result.length > 0 ? result[0].totalView : 0
            res.send({ users, normalUsers, totalView })
        })

        // statistics for dashboard home
        app.get('/publisher-statistics', async (req, res) => {
            const aggregatePipeline = [
                {
                    $group: {

                        _id: "$publisher",
                        articleCount: { $sum: 1 },
                        totalViews: { $sum: "$view" }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        publisherName: "$_id",
                        articleCount: 1,
                        totalViews: 1
                    }
                },

            ]
            const result = await articleCollection.aggregate(aggregatePipeline).toArray()
            res.send(result)
        })


        // add article to mongodb
        app.post('/add-article', async (req, res) => {
            const newArticle = req.body;
            const result = await articleCollection.insertOne(newArticle);
            res.send(result)
        })

        // update view count
        app.patch('/update-view-count/:id', async (req, res) => {
            console.log(req.params.id)
            const query = { _id: new ObjectId(req.params.id) }
            const updateDoc = {
                $inc: {
                    view: 1
                }

            }
            const result = await articleCollection.updateOne(query, updateDoc)
            res.send(result)
        })
        // add user to mongodb
        app.post('/social-users', async (req, res) => {
            const user = req.body;
            // console.log(user)
            const query = { email: user.email }
            const isExistUser = await userCollection.findOne(query);
            if (isExistUser) {
                return res.send({ message: 'User already exist', insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result)
        })

        app.post('/register-users', async (req, res) => {
            const user = req.body;
            const result = await userCollection.insertOne(user);
            res.send(result)
        })

        // add publisher
        app.post('/add-publisher', async (req, res) => {
            const user = req.body;
            const result = await publisherCollection.insertOne(user);
            res.send(result)
        })

        // payment intent
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            console.log(price)
            const amount = parseInt(price * 100);
            console.log(amount)
            if (!price || amount < 1) return;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        // Premium user information add to user info
        app.patch('/premium/:email', async (req, res) => {
            const { premiumExpireDate } = req.body;
            const filter = { email: req.params.email }
            const updatedDoc = {
                $set: {
                    premiumExpireDate,
                    isPremium: "yes"
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result)
        })

        // make admin api
        app.patch('/users/:id', async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) }
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result)
        })

        // make premium api
        app.patch('/make-premium/:id', async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) }
            const updatedDoc = {
                $set: {
                    access: 'premium'
                }
            }
            const result = await articleCollection.updateOne(filter, updatedDoc);
            res.send(result)
        })

        // article approve api
        app.patch('/approve/:id', async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) }
            const updatedDoc = {
                $set: {
                    status: 'Approved'
                }
            }
            const result = await articleCollection.updateOne(filter, updatedDoc);
            res.send(result)
        })

        // article delete api
        app.patch('/delete/:id', async (req, res) => {
            const query = { _id: new ObjectId(req.params.id) }
            const result = await articleCollection.deleteOne(query);
            res.send(result)
        })

        // article decline api
        app.patch('/decline/:id', async (req, res) => {
            const text = req.body.declined_text
            const filter = { _id: new ObjectId(req.params.id) }
            const updatedDoc = {
                $set: {
                    status: 'Declined',
                    declined_text: text
                }
            }
            const result = await articleCollection.updateOne(filter, updatedDoc);
            res.send(result)
        })

        // update article
        app.patch('/update-article/:id', async (req, res) => {
            const updatedArticle = req.body
            const filter = { _id: new ObjectId(req.params.id) }
            const updatedDoc = {
                $set: {
                    title: updatedArticle.title,
                    description: updatedArticle.description,
                    publisher: updatedArticle.publisher,
                    tags: updatedArticle.tags,
                    status: updatedArticle.status,
                    date: updatedArticle.date,
                    view: updatedArticle.view,
                    access: updatedArticle.access,
                    Image: updatedArticle.Image
                }
            }
            const result = await articleCollection.updateOne(filter, updatedDoc);
            res.send(result)
        })

        // api for delete article
        app.delete('/delete-article/:id', async (req, res) => {
            const query = { _id: new ObjectId(req.params.id) }
            const result = await articleCollection.deleteOne(query)
            res.send(result)
        })
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send("Journal published")
})

app.listen(port, () => {
    console.log(`EchoJournal is running on port ${port}`)
})