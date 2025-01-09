require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");

const nodemailer = require("nodemailer");

const port = process.env.PORT || 4000;
const app = express();
// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

//send email using nodemailer
const sendEmail = (emailAddress, emailData) => {
  // const emailData = {
  //   subject: "This is a very important subject",
  //   message: "Nice message",
  // };

  // create transporter
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // true for port 465, false for other ports
    auth: {
      user: process.env.NODEMAILSER_USER,
      pass: process.env.NODEMAILSER_PASS,
    },
  });

  // verify connection
  transporter.verify((error, success) => {
    if (error) {
      console.log(error);
    } else {
      console.log("Transporter is ready to take email: ", success);
    }
  });

  // transporter.sendMail()
  const mailBody = {
    from: process.env.NODEMAILSER_USER, // sender address
    to: emailAddress, // list of receivers
    subject: emailData?.subject, // Subject line
    // text: emailData?.message, // plain text body
    html: `<p>${emailData?.message}</p>`, // html body
  };

  // send email
  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      // console.log(info);
      console.log("Email sent successfully: ", info?.response);
    }
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.j5yqq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("plantNetDB");
    const usersCollection = db.collection("users");
    const plantsCollection = db.collection("plants");
    const ordersCollection = db.collection("orders");

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      // console.log("data from verifySeller middleware--> ", req.user?.email);

      const email = req.user?.email;
      const query = { email };
      const result = await usersCollection.findOne(query);

      if (!result || result?.role !== "admin") {
        res.status(403).send({
          message: "Forbidden access! Admin only action!!",
        });
      }

      next();
    };
    // verify seller middleware
    const verifySeller = async (req, res, next) => {
      // console.log("data from verifyAdmin middleware--> ", req.user?.email);

      const email = req.user?.email;
      const query = { email };
      const result = await usersCollection.findOne(query);

      if (!result || result?.role !== "seller") {
        res.status(403).send({
          message: "Forbidden access! Seller only action!!",
        });
      }

      next();
    };

    // save or update users in db
    app.post("/users/:email", async (req, res) => {
      sendEmail();
      const email = req.params.email;
      const query = { email };
      const user = req.body;

      // check if user is already exist in db or not
      const isExist = await usersCollection.findOne(query);

      if (isExist) {
        return res.send(isExist);
      }

      const result = await usersCollection.insertOne({
        ...user,
        role: "customer",
        timestamp: Date.now(),
      });
      res.send(result);
    });

    // manage user status and role
    app.patch("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user?.status === "Requested") {
        return res
          .status(400)
          .send("You have already requested, wait to verify your proposal");
      }
      const updateDoc = {
        $set: {
          status: "Requested",
        },
      };

      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // get all users data
    app.get("/all-users/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: { $ne: email } };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // update a user role and status
    app.patch(
      "/user/role/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const { role } = req.body;
        const filter = { email };
        const updateDoc = {
          $set: { role, status: "Verified" },
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    // get all inventory data for seller
    app.get("/plants/seller", verifyToken, verifySeller, async (req, res) => {
      const email = req.user.email;
      // const query = { email: { $ne: email } };
      const result = await plantsCollection
        .find({ "seller.email": email })
        .toArray();
      res.send(result);
    });

    // delete a plant from db by seller
    app.delete("/plants/:id", verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantsCollection.deleteOne(query);
      res.send(result);
    });

    // get user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });

    // Generate jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    //save a plant in the database
    app.post("/plants", verifyToken, verifySeller, async (req, res) => {
      const plants = req.body;
      const result = await plantsCollection.insertOne(plants);
      res.send(result);
    });

    //get all plants from the database
    app.get("/plants", async (req, res) => {
      const result = await plantsCollection.find().limit(20).toArray();
      res.send(result);
    });

    // get a plant by id
    app.get("/plants/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantsCollection.findOne(query);
      res.send(result);
    });

    //save order in the database
    app.post("/order", verifyToken, async (req, res) => {
      const orderInfo = req.body;
      console.log(orderInfo);
      const result = await ordersCollection.insertOne(orderInfo);
      // send email
      if (result?.insertedId) {
        // To customer
        sendEmail(orderInfo?.customer?.email, {
          subject: "Order Successful",
          message: `You have placed an order successfully. Transaction id: ${result?.insertedId}`,
        });

        // To seller
        sendEmail(orderInfo?.seller, {
          subject: "Hurry!, You have an order to process",
          message: `Get the plants ready for ${orderInfo?.customer?.name}`,
        });
      }
      res.send(result);
    });

    // Manage plant quantity
    app.patch("/plants/quantity/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { quantityToUpdate, status } = req.body;
      const filter = { _id: new ObjectId(id) };
      let updateDoc = {
        $inc: {
          quantity: -quantityToUpdate,
        },
      };

      if (status === "increase") {
        updateDoc = {
          $inc: {
            quantity: quantityToUpdate,
          },
        };
      }
      const result = await plantsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // get all orders for a specific customer
    app.get("/customer-orders/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "customer.email": email };
      // const result = await ordersCollection.find(query).toArray();
      const result = await ordersCollection
        .aggregate([
          {
            $match: query, // match specific customers data only by email
          },
          {
            $addFields: {
              plantId: { $toObjectId: "$plantId" }, // convert plantId string field to objectId field
            },
          },
          {
            $lookup: {
              // go to a different collection and look for data
              from: "plants", // fetch something from plants collection
              localField: "plantId", // local data that i want to match
              foreignField: "_id", // foreign field name to match the exact things that i need
              as: "plants", // return the data as plants array (here plants will be the name of returned array)
            },
          },
          {
            $unwind: "$plants", // unwind lookup result, so that it returns without array
          },
          {
            $addFields: {
              // add the below below to the order object
              name: "$plants.name",
              image: "$plants.image",
              category: "$plants.category",
            },
          },
          {
            // remove plants object property from order object
            $project: {
              plants: 0, // 0 means remove and 1 means add that specific property
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    // get all orders for a specific seller
    app.get(
      "/seller-orders/:email",
      verifyToken,
      verifySeller,
      async (req, res) => {
        const email = req.params.email;
        const query = { seller: email };
        // const result = await ordersCollection.find(query).toArray();
        const result = await ordersCollection
          .aggregate([
            {
              $match: query, // match specific customers data only by email
            },
            {
              $addFields: {
                plantId: { $toObjectId: "$plantId" }, // convert plantId string field to objectId field
              },
            },
            {
              $lookup: {
                // go to a different collection and look for data
                from: "plants", // fetch something from plants collection
                localField: "plantId", // local data that i want to match
                foreignField: "_id", // foreign field name to match the exact things that i need
                as: "plants", // return the data as plants array (here plants will be the name of returned array)
              },
            },
            {
              $unwind: "$plants", // unwind lookup result, so that it returns without array
            },
            {
              $addFields: {
                // add the below below to the order object
                name: "$plants.name",
              },
            },
            {
              // remove plants object property from order object
              $project: {
                plants: 0, // 0 means remove and 1 means add that specific property
              },
            },
          ])
          .toArray();
        res.send(result);
      }
    );

    // update a order status
    app.patch("/orders/:id", verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status },
      };
      const result = await ordersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // cancel/delete an order
    app.delete("/orders/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const order = await ordersCollection.findOne(query);
      if (order.status === "Delivered") {
        return res
          .status(409)
          .send("Cannot cancel once the product has been delivered");
      }
      const result = await ordersCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from plantNet Server..");
});

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`);
});
