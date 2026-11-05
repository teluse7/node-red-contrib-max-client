module.exports = function (RED) {
    "use strict";

    function MaxPanelNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name || "";
        this.config = config.config;
        this.panelName = (config.panelName || "\u041f\u0430\u043d\u0435\u043b\u044c \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f").trim();

        this.isActiveByDefault = config.isActiveByDefault || false;

        this.on("close", (done) => done())
    }
    RED.nodes.registerType("max-panel", MaxPanelNode)
}
