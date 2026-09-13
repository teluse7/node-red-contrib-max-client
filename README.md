node-red-contrib-max-client
===================

Install
-------

Version 1.x of this node is usually installed by default by Node-RED.
As long as you have at least version 0.19.x of Node-RED you can install the new version
by using the `Menu - Manage Palette` option, or running the following command in your
Node-RED user directory - typically `~/.node-red`

        cd ~/.node-red
        npm i node-red-contrib-max-client

Usage
-----

The node send a message from `msg.payload` to the messenger MAX at the `Phone` number with the `Token` access key via the MAX-bot at the `URL` address.
If the message contains web links, then if the `Render` checkbox is checked, screenshots of the specified pages will be sent to the messenger.
Some pages, especially those included with Dashboard 2.0 for Node-RED, require additional loading control (Canvas control). To do this, check the `Control` checkbox.
For the ArmV7 platform, you need to install the external `teluse7/puppeteer-armv7` service in the container and specify its address and port in the `Service`.
When setting up the container, specify internal port 3000 and the TZ variable (default: Europe/Moscow), and set the RAM limit to 2,560,000,000 and the CPU limit to 30.


### Input

Specify the URL, phone number and access key in the `URL`, `Phone` and `Token`.
Place the text of message in the `msg.payload`.
Check the `Render` checkbox to send screenshots.
Check the `Control` checkbox if the page requires additional loading control.
If the node is running on the ArmV7 platform, additionally specify the screenshot service address and port in the `Service`.

### Output

The result of sending the message will be displayed below in the node status.
The sent text will be in `msg.payload`.