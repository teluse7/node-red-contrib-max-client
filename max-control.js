module.exports = function (RED) {
    "use strict";

    function MaxControlNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name || "";
        node.buttonText = config.buttonText || "";
        node.buttonPayload = config.buttonPayload || "";
        node.targetPanel = config.targetPanel;

        // Get panel node
        node.panelNode = RED.nodes.getNode(config.targetPanel);
        if (!node.panelNode) {
            node.error(RED._("max-control.error.panelNotFound"));
            return
        }

        // Get config node through panel
        node.configNode = RED.nodes.getNode(node.panelNode.config);
        if (!node.configNode) {
            node.error(RED._("max-control.error.configNotFound"));
            return
        }

        node.onMaxEvent = function (event) {
            const userId = event.user || null;
        
            if (userId) 
                node.status({ fill: "blue", shape: "dot", text: RED._("max-control.status.callbackUser") + userId })
            else
                node.status({ fill: "blue", shape: "dot", text: "max-control.status.callback" });

            var msg = {
                topic: node.buttonPayload,
                raw: event,
                payload: {
                    user: userId,
                    action: node.buttonPayload, 
                    button: node.buttonText 
                }
            }
            node.send(msg)
        }

        node.onMaxStatus = (status) => {
            if (status.type === "connected") 
                node.status({ fill: "green", shape: "dot", text: "max-control.status.connected" })
            else if (status.type === "partial") 
                node.status({ fill: "yellow", shape: "ring", text: RED._("max-control.status.partial") + (status.connected || 0) + "/" + (status.total || 0) })
            else if (status.type === "panel_sent") 
                node.status({ fill: "blue", shape: "dot", text: "max-control.status.panelSent" })
            else 
                node.status({ fill: "red", shape: "ring", text: "max-control.status.disconnected" })
        }

        node.configNode.addListener(node);

        node.on("close", () => node.configNode?.removeListener(node))
    }

    RED.nodes.registerType("max-control", MaxControlNode)
}
