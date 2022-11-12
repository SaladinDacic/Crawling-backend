const express = require("express");
var app = express();
// ___________________________________________________________
// ___________________BASIC MIDDLEWARE________________________
const request = require("request-promise");
const cheerio = require("cheerio");
const cors = require("cors");
// ___________________________________________________________
// ___________________BASIC MIDDLEWARE________________________
const morgan = require("morgan");
const { Pool } = require("pg");
require("dotenv").config(); //for environment variables
let pool = new Pool();
const CryptoJS = require("crypto-js")


// ___________________________________________________________
// ___________________BASIC MIDDLEWARE________________________
app.use(morgan("common"));
app.use(cors());
app.use(morgan("common"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ___________________________________________________________
// ____________________SCRAPING OLX.ba_________________________
try {
  try {
    pool.connect(async (error, client, relase) => {
      await client.query(`CREATE TABLE IF NOT EXISTS public.crawling
          (
              job_id character varying COLLATE pg_catalog."default" NOT NULL,
              job_name character varying COLLATE pg_catalog."default",
              job_url character varying COLLATE pg_catalog."default",
              updated_at real[],
              created_at real,
              status character varying(100) COLLATE pg_catalog."default",
              brand character varying(100) COLLATE pg_catalog."default",
              title character varying(100) COLLATE pg_catalog."default",
              image_url character varying COLLATE pg_catalog."default",
              CONSTRAINT crawling_pkey PRIMARY KEY (job_id)
          )`);

      relase();
    });
  } catch (error) {
    console.log(error);
  }

  class Node {
    constructor(val) {
      this.job_url = val.job_url;
      this.job_name = val.job_name;
      this.status = "enqueued";
      this.created_at = Date.now();
      this.updated_at = [];
      this.job_id = JSON.stringify(CryptoJS.MD5(val.job_url));
      this.next = null;
    }
  }
  class Queue {
    constructor() {
      this.first = null;
      this.last = null;
      this.length = 0;
      this.allJobs = [];
      this.allData = [];
    }
    enqueue(val) {
      let node = new Node(val);
      if (!this.first) {
        this.first = node;
        this.last = this.first;
      } else {
        this.last.next = node;
        this.last = node;
      }
      this.length++;
      return this;
    }
    dequeue() {
      if (!this.first) return null;
      let currentFirst = this.first;
      if (this.length === 1) {
        this.first = null;
        this.last = null;
      } else {
        this.first = this.first.next;
      }
      currentFirst.next = null;
      this.length--;
      return currentFirst;
    }
  }
  var queue = new Queue();

  async function landingPage(res = null) {
    try {
      await pool.connect(async (error, client, relase) => {
        const response = await client.query(`SELECT * FROM crawling`);
        let databaseData = await response.rows;
        relase();
        while (queue.length) {
          const node = await queue.dequeue();

          if (
            databaseData.find((obj, idx) => {
              console.log(obj, node.job_id);
              return obj.job_id === node.job_id;
            }) === undefined &&
            queue.allJobs.find((obj, idx) => {
              return obj.job_id === node.job_id;
            }) === undefined
          ) {
            queue.allJobs.push(node);
            try {
              let data = {};
              node.status = "in_progress";
              node.updated_at.push(Date.now());
              let html = await request(node.job_url);
              const $ = await cheerio.load(html); //insert jQuery to NodeJs
              data.image_url = $("section > div > div > * > div > img").attr("src");
              data.brand = $("* > h1 > a").attr("title");
              data.title = $($("* > h1 > span")[0]).text();

              node.status = "completed";
              node.updated_at.push(Date.now());
              console.log(node);

              queue.allData.push(data);
            } catch (err) {
              if (node) node.status = "failed";
              console.log(err, node);
            }
          }
        }
        if (res) res.send("done");
      });
    } catch (error) {
      console.log(error);
    }
  }

  {
    app.post("/addJob", async (req, res) => {
      const { job_url, job_name } = req.body;
      const job = { job_url, job_name };
      queue.enqueue(job);
      await landingPage(res);
    });
    app.post("/addMultiple", async (req, res) => {
      console.log("DOSLO");
      const { job_url_arr, job_name } = req.body;
      const job_arr = job_url_arr.map((url, idx) => {
        return { job_url: url, job_name };
      });
      job_arr.forEach((job, idx) => {
        queue.enqueue(job);
      });
      await landingPage(res);
    });
    //GET-DATA
    app.get("/getAllJobs", async (req, res) => {
      res.send(JSON.stringify(queue.allJobs));
    });
    app.get("/getAllData", (req, res) => {
      res.send(JSON.stringify(queue.allData));
    });
    app.get("/getJob", (req, res) => {
      res.send(JSON.stringify(queue.allJobs[queue.allJobs.length - 1]));
    });
    app.get("/getJobFromQueue", async (req, res) => {
      res.send(await landingPage());
    });
  }
  {
    app.get("/loadOldData", (req, res) => {
      try {
        pool.connect(async (error, client, relase) => {
          let response = await client.query(`SELECT * FROM "crawling"`);
          relase();
          let oldData = response.rows.map((obj) => {
            return { image_url: obj.image_url, brand: obj.brand, title: obj.title };
          });
          res.send(oldData);
        });
      } catch (error) {
        console.log(error);
      }
    });
    app.post("/saveDataAndJobs", (req, res) => {
      try {
        pool.connect(async (error, client, relase) => {
          const combinedData = queue.allData.map((obj, idx) => {
            return { ...obj, ...queue.allJobs[idx] };
          });

          combinedData.forEach(async (node, idx) => {
            /* console.log(`INSERT INTO crawling (job_id, job_name, job_url, updated_at, created_at, status, brand, title, image_url) VALUES ('${node.job_id}', '${node.job_name}','${node.job_url}', ARRAY[${node.updated_at}],${node.created_at},'${node.status}','${node.brand}','${node.title}','${node.image_url}')`); */
            await client.query(`INSERT INTO crawling (job_id, job_name, job_url, updated_at, created_at, status, brand, title, image_url) VALUES ('${node.job_id}', '${node.job_name}','${node.job_url}', ARRAY[${node.updated_at}],${node.created_at},'${node.status}','${node.brand}','${node.title}','${node.image_url}')`);
          });
          relase();
          res.send("saved");
        });
      } catch (error) {
        console.log(error);
      }
    });
  }
} catch (error) {
  console.log(error)
}




// ___________________________________________________________
// ______________________LISTEN PORT_________________________
app.listen(process.env.PORT || 3001, () => {
  console.log("Server started!!");
});
