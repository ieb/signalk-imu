/*jshint node:true */
"use strict";
/*
 * Copyright 2017 Ian Boston <ianboston@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const Bacon = require('baconjs');
const fs = require('fs');
const async = require('async');


module.exports = function(app) {
  var BNO055;
  if ( fs.existsSync('/sys/class/i2c-adapter') ) { 
    // 1 wire is enabled a
    BNO055 = require('node-bno055');

    console.log("signalk-imu: BMO055 avaiable. ");
  } else {
    BNO055 = require('./fakesensor');
    console.log("signalk-imu: BMO055 not available, Created Fake Sensor ");
  }

  var plugin = {};
  var unsubscribes = [];

  function convertToK(v) {
    return v+273.15;
  }


  plugin.start = function(config) {
    // console.log("IMU Config ", JSON.stringify(config));
   
    var bno055 = new BNO055(config);

    var configStatus = undefined;
    var calibrated = false;
    var callSequence = {
      checkCalibration: function(callback) {
        if ( !calibrated ) {
          bno055.getCalibrationStatus((err, res) =>{
            if (err) return callback(err);
            res.system  = "Ok";
            res.gyro = "Ok";
            res.mag = "Ok";
            res.accel = "Ok";
            res.cfgStatus = 0;
            if ( res.systemStatus !== 0x03 ) {
              res.system = "Needs calibration.";
              res.cfgStatus = res.cfgStatus | 0x01;
            }
            if ( res.gyroStatus !== 0x03 ) {
              res.gyro = "Gyro needs calibrating, keep sensor still for a few seconds.";
              res.cfgStatus = res.cfgStatus | 0x02;
            }
            if ( res.accelerometerStatus !== 0x03 ) {
              res.accel = "Accelerometer needs calibrating, Slowly move between 6 stable positions, and hold for > 2s in each.";
              res.cfgStatus = res.cfgStatus | 0x04;
            }
            if ( res.magnetometerStatus !== 0x03 ) {
              res.mag = "Magnatomiter needs calibrating, Perform figure of 8 movements.";
              res.cfgStatus = res.cfgStatus | 0x08;
            }
            if ( res.cfgStatus !== 0 ) {
              if (configStatus === undefined || configStatus.cfgStatus !== res.cfgStatus ){
                console.log("BNO055 Calibration May be required. ", res);
              }
              configStatus = res;
              callback(null, res);
            } else {
              configStatus = res;
              calibrated = true;
              console.log("BNO055 Calibration Ok.")
              callback(null, res);
            }
          });
        } else {
          callback(null, configStatus);
        }
      },
      temperature: function(callback) { bno055.getTemperature(callback)},
      euler: function(callback) { bno055.getEuler(callback)},
      laccel: function(callback) { bno055.getLinearAcceleration(callback)},
      gyro: function(callback) { bno055.getGyroscope(callback)}
    };
    bno055.beginNDOF((err, startOk) => {
      if ( err ) {
        console.log("IMU Failed to start", err);
      } else {
        plugin.motionInterval = setInterval(() => {
          async.series(callSequence, (err, res) => {
            if (err) {
              console.log("Failed to read IMU", err, res);
            } else {
              var delta = {
                "context": "vessels." + app.selfId,
                "updates": [
                  {
                    "source": {
                      "src": "BNO055"
                    },
                    "timestamp": (new Date()).toISOString(),
                    "values": [
                        {
                          "path" : "environment.inside.temperature",
                          "value" : convertToK(res.temperature)
                        },
                        {
                          "path": "navigation.rateOfTurn",
                          "value": res.gyro.z
                        },
                        {
                          "path": "navigation.gyro.roll",
                          "value": res.gyro.x
                        },
                        {
                          "path": "navigation.gyro.pitch",
                          "value": res.gyro.y
                        },
                        {
                          "path": "navigation.gyro.yaw",
                          "value": res.gyro.z
                        },
                        {
                          "path": "navigation.accel.x",
                          "value": res.laccel.x
                        },
                        {
                          "path": "navigation.accel.y",
                          "value": res.laccel.y
                        },
                        {
                          "path": "navigation.accel.z",
                          "value": res.laccel.z
                        },
                        {
                          "path": "navigation.headingMagnetic",
                          "value": res.euler.heading,
                        },
                        {
                          "path": "navigation.attitude.roll",
                          "value": res.euler.roll,
                        },
                        {
                          "path": "navigation.attitude.pitch",
                          "value": res.euler.pitch,
                        }
                      ]
                  }
                ]
              };
              //console.log("signalk-imu got motion delta: " + JSON.stringify(delta))
              app.handleMessage(plugin.id, delta);
            }
          });
        
        },  config.motionPeriod);
      }
    });


    
  }

  plugin.stop = function() {
    if ( plugin.environmentInterval !== undefined ) {
      clearInterval(plugin.environmentInterval);
    }
    if ( plugin.motionInterval !== undefined ) {
      clearInterval(plugin.motionInterval);
    }
  }

  plugin.id = "sk-imu"
  plugin.name = "IMU Source"
  plugin.description = "Plugin that reads IMU data"

  plugin.schema = {
    title: "IMU Source",
    description: "This plugin reads data from a I2C attached BNO055 defice. The device should be set up so that the BNO055 on the chip is towards the bow.",
    type: "object",
    properties: {
      motionPeriod : {
        title: "Period of motion readings in ms",
        type: "integer",
        default: 1000
      }
    }
  }



  plugin.uiSchema = {
    "ui:order": [
    'motionPeriod'
    ]
  };


  return plugin;
}
