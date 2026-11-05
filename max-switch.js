module.exports = function (RED) {
    "use strict";

    function MaxSwitchNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name || "";
        node.targetPanel = config.targetPanel;

        var targetPanel = RED.nodes.getNode(config.targetPanel);
        if (!targetPanel) {
            node.error(RED._("max-switch.log.noPanel"));
            node.status({ fill: "red", shape: "ring", text: "max-switch.log.noPanel" });
            return
        }

        var configNode = RED.nodes.getNode(targetPanel.config);
        if (!configNode) {
            node.error(RED._("max-switch.log.noConfig"));
            node.status({ fill: "red", shape: "ring", text: "max-switch.log.noConfig" });
            return
        }

        node.on("input", function (msg) {
            const user = msg.payload && msg.payload.user;
            const panelName = targetPanel.panelName;

            if (user && user !== "") {
                configNode.switchPanel(panelName, user);
                node.status({ fill: "green", shape: "dot", text: RED._("max-switch.status.switchedUser") + user })
            } else {
                configNode.switchPanel(panelName);
                node.status({ fill: "green", shape: "dot", text: "max-switch.status.switched" })
            }
        })
    }

    RED.nodes.registerType("max-switch", MaxSwitchNode)
}
