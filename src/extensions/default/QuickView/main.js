/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/*jslint regexp: true */

define(function (require, exports, module) {
    const ExtensionUtils      = brackets.getModule("utils/ExtensionUtils");
    require("./colorGradientProvider");
    require("./ImagePreviewProvider");

    // Load our stylesheet
    ExtensionUtils.loadStyleSheet(module, "QuickView.less");

    const SelectionViewManager = brackets.getModule("features/SelectionViewManager");
    SelectionViewManager.registerSelectionViewProvider(exports, ["all"]);
    exports.getSelectionView = function(editor, selections) {
        return new Promise((resolve, reject)=>{
            resolve({
                content: "<div>hello world</div>"
            });
        });
    };
});
