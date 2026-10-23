/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "MessagePopoverAPI",
    description: "API to add buttons to message popovers.",
    authors: [Devs.KingFish, Devs.Ven, Devs.Nuckyz],
    patches: [
        {
            find: "#{intl::MESSAGE_UTILITIES_A11Y_LABEL}",
            replacement: {
                match: /(?<=\((\i\.qv),\{label:[^}]+?\},"reply-self"\):null\]\}\):null,)\i\?\(0,\i\.jsxs?\)\(\i\.Fragment,\{children:\[.{0,200}?togglePopout:.+?message:(\i)\}\)\]\}\):null,/,
                replace: "$&Vencord.Api.MessagePopover._buildPopoverElements($1,$2),"
            }
        }
    ]
});
