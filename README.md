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

The package provides nodes for the MAX messenger:
- `max-ws-config` — WebSocket connection and panel management
- `max-panel` — control panel configuration
- `max-control` — panel buttons
- `max-switch` — panel switching
- `max-send` — message sending with optional page screenshots

### max-send

Node for sending messages and screenshots via a MAX-bot.

**Overview**
Sends a message from **msg.payload** or **msg.payload.text** to the MAX messenger. When the option is enabled, it takes screenshots of web pages and attaches them to the message.

**Settings**
- **Name** — Node name displayed in the Node-RED editor. If not specified, "max-send" is used.
- **Connection (required)** — Reference to a `max-ws-config` node (MAX connection settings). Saving is not possible unless this node is selected.
- **Take screenshots** — If enabled, the node will try to take screenshots of pages referenced by links in the message. Requires access to a screenshot service or a local Puppeteer instance.
- **Wait for rendering to complete** — Enables waiting for the page to be fully rendered before taking a screenshot. Useful for Dashboard 2.0 panels and dynamic charts.
- **Service** — Address of an external service (e.g., *teluse7/puppeteer-armv7*) used for remote rendering. Leave empty if the screenshot is taken locally in the Node-RED container.

**Statuses**
- **Yellow ring** � the node is initializing.
- **Green dot** � the last message was sent successfully.
- **Red circle** � a send failure occurred.

**Notes (for ArmV7)**
To work with screenshots on the ArmV7 platform, the external *teluse7/puppeteer-armv7* service must be installed in the container, and its address and port specified in the **Service** field.
When setting up the container, specify:

- Service internal port: *3000*
- **TZ** environment variable: default is *Europe/Moscow*
- **RAM** limit: *2560000000* bytes (2.5 GB) is recommended for stable Puppeteer operation on iHost
- **CPU** limit: *30* (percent) is recommended to prevent overloading the device during screenshot generation

### Input

- **msg.payload** — Message text to be sent to MAX. If the message contains links and the *Take screenshots* option is enabled, screenshots will be generated.
  If **msg.payload.user** is set, the message text must be placed in **msg.payload.text**.
- **msg.payload.user (optional)** — User ID (when the message should be sent to a specific recipient only). If the field is missing, the message is sent to all users from the connection.

### max-ws-config

MAX bot connection configuration node.
Supports multiple users, automatic reconnection, and panel management.
Establishes persistent WSS connections to the MAX server, through which it receives panel button press events. It is also responsible for sending and updating the button panel.

**Settings**
- **URL (required)** — MAX bot address without protocol. The `https://` and `wss://` protocols are automatically stripped. Example: `notify.example.com`
- **Interval (required)** — Panel auto-refresh interval in seconds. Default is 28800 (8 hours). A value of `0` disables auto-refresh. On refresh, the old message is removed and a new one is sent.
- **MID key (required)** — Name of the global variable to store the message identifier (MID). **Must be unique** among all `max-ws-config` nodes. Used to delete the old panel before sending a new one.
  The Node-RED context storage for the MID key is selected from the options available in `settings.js`. It is recommended to choose `file` to preserve the value across restarts.
- **Recipients (required)** — User ID to which the control panel with buttons is sent.
  Authorization token for connecting to the MAX bot. Passed in the `Authorization` header.

**Behavior**
On start, the node establishes WSS connections with the MAX server. After connecting:

- Sends the main button panel (from `max-control` nodes) to all recipients
- Maintains the connection with pings every 25 seconds
- Refreshes the panel by timer (if interval > 0)
- Automatically reconnects after 5 seconds if the connection is lost

Buttons in the panel are arranged automatically: 3 per row if there are fewer than 10 buttons, and 4 per row if there are 10 or more.

**Credentials**
The token is stored in Node-RED credentials and is not visible in the flow.

### max-panel

MAX panel configuration node.
Each connection can have multiple panels, but only one is active at any given time.

**Settings**
- **Name** — The node name displayed in the Node‑RED editor. If not specified, the panel title is used.
- **Connection (required)** — Reference to the `max-ws-config` node (WebSocket connection). This field must be selected; saving is not possible without it.
- **Title (required)** — Text displayed in the MAX panel header. This is the text visible to the user.
- **Default main panel (required)** — Checkbox to set this panel as the main one on startup and refresh. **Must be unique** among all `max-panel` nodes for the selected connection.

**Behavior**
On start, the node specified in **Connection** establishes WSS connections with the MAX server. After connecting:

- Sends the main panel with buttons to all recipients of the specified `max-ws-config` connection
- Refreshes the panel to the main one by timer (if the interval > 0)
- Switches the current panel to the selected one using the `max-switch` node

Buttons in the panel are arranged automatically: 3 per row if there are fewer than 10 buttons, and 4 per row if there are 10 or more.

### max-control

MAX control button node.
Creates a button in the MAX control panel. When the button is clicked in MAX, the node sends a message to the output port.

**Settings**
- **Name** — The node name displayed in the Node‑RED editor. If not specified, the button text or “max-control” is used.
- **Panel (required)** — Reference to the `max-panel` node (control panel in MAX). This field must be selected; saving is not possible without it.
- **Button (required)** — Text displayed on the button in the MAX control panel. This is the text visible to the user.
- **Action (required)** — Unique action identifier. **Must be unique** among all `max-control` nodes. When the button is clicked, MAX sends an event with this identifier, and the node matches it to the corresponding button.

**Statuses**
- **Yellow ring** — initializing
- **Green dot** — connected to MAX
- **Red ring** — disconnected from MAX
- **Blue dot** — last action

### Output

- **payload.user** — Identifier of the user who clicked the button.
- **payload.action** — Action value — the value specified in the “Action” field.
- **payload.button** — Button text as specified in the settings.
- **raw** — Full event object received from MAX via WebSocket.

### max-switch

MAX panel switch node.
Switches the active panel to the specified one. Accepts any incoming message.
If the **topic** contains a user identifier, the switch is applied only to that user.

**Settings**
- **Name** — The node name displayed in the Node-RED editor. If not specified, “max-switch” is used.
- **Panel (required)** — Reference to the `max-panel` node (control panel in MAX). This field must be selected; saving is not possible without it.

**Statuses**
- **Yellow ring** — initializing
- **Green dot** — panel switched
- **Red ring** — disconnected from MAX

### Input

- **payload.user** — User identifier if the switch should be applied to a specific user only.
