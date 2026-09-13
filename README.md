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
If the message contains a web link, a screenshot of the specified page will be sent to the messenger.

### Input

Specify the URL, phone number and access key in the `URL`, `Phone` and `Token`.
Place the text of message in the `msg.payload`.

### Output

The result of sending the message will be displayed below in the node status.
The sent text will be in `msg.payload`.