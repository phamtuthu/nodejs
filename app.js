const express = require('express');
const bodyParser = require('body-parser');
const https = require('https');
const app = express();

// Cấu hình body-parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Hàng đợi xử lý yêu cầu
let requestQueue = [];
let isProcessing = false;

app.get("/", (req, res) => {
  res.send("App is running!");
});

// Xử lý POST từ Bitrix24
app.post("/bx24-event-handler", (req, res) => {
  const callEndData = req.body.data;
  const callId = callEndData.CALL_ID;

  if (!callId) {
    console.error("Error: Missing CALL_ID in request.");
    return res.status(400).send("Missing CALL_ID in request.");
  }

  console.log(`Received request for Call ID: ${callId}`);
  requestQueue.push({ callId, res });

  if (!isProcessing) {
    processNextRequest();
  }
});

// Hàm xử lý yêu cầu trong hàng đợi
function processNextRequest() {
  if (requestQueue.length === 0) {
    console.log("Request queue is empty. Stopping processing.");
    isProcessing = false;
    return;
  }

  isProcessing = true;

  const { callId, res } = requestQueue.shift();

  getVoximplantStatistic(callId, (crmEntityId, crmEntityType, callFailedCode, callDuration, callstartdate) => {
    if (!crmEntityId) {
      console.error("Error: Missing CRM_ENTITY_ID.");
      res.status(400).send("Missing CRM_ENTITY_ID.");
      processNextRequest();
      return;
    }

    if (crmEntityType === "DEAL") {
      updateDealField(crmEntityId, callFailedCode, callDuration, callstartdate, res, () => {
        processNextRequest();
      });
    } else if (crmEntityType === "CONTACT") {
      findDealByContact(crmEntityId, (dealId) => {
        if (!dealId) {
          console.error("Error: No Deal linked to Contact ID.");
          res.status(400).send("No Deal linked to Contact ID.");
          processNextRequest();
          return;
        }
        updateDealField(dealId, callFailedCode, callDuration, callstartdate, res, () => {
          processNextRequest();
        });
      });
    } else {
      console.error("Error: Unsupported CRM_ENTITY_TYPE.");
      res.status(400).send("Unsupported CRM_ENTITY_TYPE.");
      processNextRequest();
    }
  });
}

// Hàm lấy thống kê từ voximplant.statistic.get
function getVoximplantStatistic(callId, callback) {
  const apiUrl = `https://giaohangnhanh.bitrix24.vn/rest/155/c1djflm3khd5wjv5/voximplant.statistic.get/?FILTER[CALL_ID]=${callId}`;

  https.get(apiUrl, (resp) => {
    let data = '';

    resp.on('data', (chunk) => {
      data += chunk;
    });

    resp.on('end', () => {
      const result = JSON.parse(data);
      if (result.error) {
        console.error("Error fetching call statistics:", result.error);
        callback(null, null, null, null, null);
      } else {
        const crmEntityId = result.result[0].CRM_ENTITY_ID;
        const crmEntityType = result.result[0].CRM_ENTITY_TYPE;
        const callFailedCode = result.result[0].CALL_FAILED_REASON;
        const callDuration = result.result[0].CALL_DURATION;
        const callstartdate = result.result[0].CALL_START_DATE;

        console.log(
          `Fetched CRM_ENTITY_ID: ${crmEntityId}, CRM_ENTITY_TYPE: ${crmEntityType}, CALL_FAILED_REASON: ${callFailedCode}, CALL_DURATION: ${callDuration}, CALL_START_DATE: ${callstartdate}`
        );

        callback(crmEntityId, crmEntityType, callFailedCode, callDuration, callstartdate);
      }
    });
  }).on("error", (err) => {
    console.error("Error:", err.message);
    callback(null, null, null, null, null);
  });
}

// Hàm tìm Deal ID từ Contact ID
function findDealByContact(contactId, callback) {
  const apiUrl = `https://giaohangnhanh.bitrix24.vn/rest/155/c1djflm3khd5wjv5/crm.deal.list/?FILTER[CONTACT_ID]=${contactId}`;

  https.get(apiUrl, (resp) => {
    let data = '';

    resp.on('data', (chunk) => {
      data += chunk;
    });

    resp.on('end', () => {
      const result = JSON.parse(data);
      if (result.error || !result.result.length) {
        console.error("Error or no deals found for Contact ID:", result.error || "No deals found");
        callback(null);
      } else {
        const dealId = result.result[0].ID;
        console.log(`Found Deal ID ${dealId} for Contact ID ${contactId}`);
        callback(dealId);
      }
    });
  }).on("error", (err) => {
    console.error("Error:", err.message);
    callback(null);
  });
}
/*function convertTimezone(dateString, targetOffset) {
  const date = new Date(dateString); // Chuyển đổi chuỗi ngày tháng thành đối tượng Date
  const utc = date.getTime() + date.getTimezoneOffset() * 60000; // Lấy giờ UTC
  return new Date(utc + targetOffset * 3600000).toISOString(); // Thêm offset và chuyển lại thành ISO string
}*/
function convertTimezone(dateString, targetOffset) {
  const date = new Date(dateString); // Chuyển đổi chuỗi ngày tháng thành đối tượng Date
  const utc = date.getTime() + date.getTimezoneOffset() * 60000; // Lấy giờ UTC
  const newDate = new Date(utc + targetOffset * 3600000); // Thêm offset

  // Thêm 1 giờ vào thời gian
  newDate.setHours(newDate.getHours() + 1);

  return newDate.toISOString(); // Trả về ISO string
}

// Hàm cập nhật Deal
function updateDealField(dealId, callFailedCode, callDuration, callstartdate, res, callback) {
  if (!dealId || (!callFailedCode && !callDuration && !callstartdate)) {
    console.error("Error: Missing required fields for updating deal.");
    res.status(400).send("Missing required fields for updating deal.");
    callback();
    return;
  }

 /*const fieldsToUpdate = {};
  if (callFailedCode) fieldsToUpdate["UF_CRM_668BB634B111F"] = callFailedCode;
  if (callDuration) fieldsToUpdate["UF_CRM_66C2B64134A71"] = callDuration;
  if (callstartdate) fieldsToUpdate["UF_CRM_1733474117"] = callstartdate;
  */
  const fieldsToUpdate = {};
  if (callFailedCode) fieldsToUpdate["UF_CRM_668BB634B111F"] = callFailedCode;
  if (callDuration) fieldsToUpdate["UF_CRM_66C2B64134A71"] = callDuration;
  if (callstartdate) {
  const callstartdateInUTC7 = convertTimezone(callstartdate, 3, 7); // Chuyển từ UTC+3 sang UTC+7
  fieldsToUpdate["UF_CRM_1733474117"] = callstartdateInUTC7;
}


  const apiUrl = `https://giaohangnhanh.bitrix24.vn/rest/155/c1djflm3khd5wjv5/crm.deal.update.json/?ID=${dealId}`;

  const dataToSend = JSON.stringify({
    fields: fieldsToUpdate,
  });

  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  };

  const req = https.request(apiUrl, options, (resp) => {
    let data = '';

    resp.on('data', (chunk) => {
      data += chunk;
    });

    resp.on('end', () => {
      const result = JSON.parse(data);
      if (result.error) {
        console.error("Error updating deal:", result.error);
        res.status(500).send("Error updating deal.");
      } else {
        console.log(`Deal ID ${dealId} updated successfully.`);
        res.send(`Deal ID ${dealId} updated successfully.`);
      }
      callback();
    });
  });

  req.on("error", (err) => {
    console.error("Error:", err.message);
    callback();
  });

  req.write(dataToSend);
  req.end();
}

// Lắng nghe trên cổng 3000
const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port);
});
