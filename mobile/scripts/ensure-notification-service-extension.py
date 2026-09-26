"""
Idempotently add FlyFamNotificationService (NSE) target to the Xcode project
and embed it in the main FlyFam app. Safe to re-run.
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1] / "ios" / "FlyFam.xcodeproj" / "project.pbxproj"

# Stable 24-char hex IDs (valid Xcode object IDs)
IDS = {
    "swift_ref": "B71F01A10000000000000001",
    "plist_ref": "B71F01A10000000000000002",
    "appex_ref": "B71F01A10000000000000003",
    "swift_build": "B71F01B10000000000000001",
    "appex_embed": "B71F01B10000000000000002",
    "sources_phase": "B71F01C10000000000000001",
    "frameworks_phase": "B71F01C10000000000000002",
    "resources_phase": "B71F01C10000000000000003",
    "target": "B71F01D10000000000000001",
    "dep": "B71F01D10000000000000002",
    "container": "B71F01D10000000000000003",
    "group": "B71F01E10000000000000001",
    "cfg_list": "B71F01F10000000000000001",
    "cfg_debug": "B71F01F10000000000000002",
    "cfg_release": "B71F01F10000000000000003",
}


def main() -> int:
    text = PROJECT.read_text(encoding="utf-8")
    if "FlyFamNotificationService" in text and IDS["target"] in text:
        # Target exists — ensure it's embedded + depended on (idempotent re-wire).
        changed = False
        if f"{IDS['appex_embed']} /* FlyFamNotificationService.appex in Copy Files */" not in text:
            needle = (
                "\t\t\t\t4AAE30B7EBD74159B17042E1 /* FlyFamShareExtension.appex in Copy Files */,\n"
                "\t\t\t);\n"
                "\t\t\tname = \"Copy Files\";\n"
            )
            repl = (
                "\t\t\t\t4AAE30B7EBD74159B17042E1 /* FlyFamShareExtension.appex in Copy Files */,\n"
                f"\t\t\t\t{IDS['appex_embed']} /* FlyFamNotificationService.appex in Copy Files */,\n"
                "\t\t\t);\n"
                "\t\t\tname = \"Copy Files\";\n"
            )
            if needle in text:
                text = text.replace(needle, repl, 1)
                changed = True
        dep_block = (
            "\t\t\tdependencies = (\n"
            "\t\t\t\tF54EBAD599154DD5B60485FB /* PBXTargetDependency */,\n"
            "\t\t\t);\n"
            "\t\t\tname = FlyFam;\n"
        )
        dep_with = (
            "\t\t\tdependencies = (\n"
            "\t\t\t\tF54EBAD599154DD5B60485FB /* PBXTargetDependency */,\n"
            f"\t\t\t\t{IDS['dep']} /* PBXTargetDependency */,\n"
            "\t\t\t);\n"
            "\t\t\tname = FlyFam;\n"
        )
        if dep_block in text and f"{IDS['dep']} /* PBXTargetDependency */" not in text.split("name = FlyFam;")[0][-500:]:
            text = text.replace(dep_block, dep_with, 1)
            changed = True
        targets_without = (
            "\t\t\t\t5FF537CF1C6C4C639F7DB05F /* FlyFamShareExtension */,\n"
            "\t\t\t);\n"
            "\t\t};\n"
            "/* End PBXProject section */"
        )
        targets_with = (
            "\t\t\t\t5FF537CF1C6C4C639F7DB05F /* FlyFamShareExtension */,\n"
            f"\t\t\t\t{IDS['target']} /* FlyFamNotificationService */,\n"
            "\t\t\t);\n"
            "\t\t};\n"
            "/* End PBXProject section */"
        )
        if targets_without in text:
            text = text.replace(targets_without, targets_with, 1)
            changed = True
        if changed:
            PROJECT.write_text(text, encoding="utf-8")
            print("NSE target re-wired (embed + dependency + project targets)")
        else:
            print("NSE target already present and wired — skip")
        return 0

    # PBXBuildFile
    text = text.replace(
        "/* Begin PBXBuildFile section */\n",
        "/* Begin PBXBuildFile section */\n"
        f"\t\t{IDS['swift_build']} /* NotificationService.swift in Sources */ = "
        f"{{isa = PBXBuildFile; fileRef = {IDS['swift_ref']} /* NotificationService.swift */; }};\n"
        f"\t\t{IDS['appex_embed']} /* FlyFamNotificationService.appex in Copy Files */ = "
        f"{{isa = PBXBuildFile; fileRef = {IDS['appex_ref']} /* FlyFamNotificationService.appex */; }};\n",
        1,
    )

    # PBXContainerItemProxy
    if "/* Begin PBXContainerItemProxy section */" in text:
        text = text.replace(
            "/* Begin PBXContainerItemProxy section */\n",
            "/* Begin PBXContainerItemProxy section */\n"
            f"\t\t{IDS['container']} /* PBXContainerItemProxy */ = {{\n"
            f"\t\t\tisa = PBXContainerItemProxy;\n"
            f"\t\t\tcontainerPortal = 83CBB9F71A601CBA00E9B192 /* Project object */;\n"
            f"\t\t\tproxyType = 1;\n"
            f"\t\t\tremoteGlobalIDString = {IDS['target']};\n"
            f"\t\t\tremoteInfo = FlyFamNotificationService;\n"
            f"\t\t}};\n",
            1,
        )

    # Copy Files phase — add embed entry
    text = text.replace(
        "\t\t\tfiles = (\n"
        "\t\t\t\t4AAE30B7EBD74159B17042E1 /* FlyFamShareExtension.appex in Copy Files */,\n"
        "\t\t\t);\n"
        "\t\t\tname = \"Copy Files\";\n",
        "\t\t\tfiles = (\n"
        "\t\t\t\t4AAE30B7EBD74159B17042E1 /* FlyFamShareExtension.appex in Copy Files */,\n"
        f"\t\t\t\t{IDS['appex_embed']} /* FlyFamNotificationService.appex in Copy Files */,\n"
        "\t\t\t);\n"
        "\t\t\tname = \"Copy Files\";\n",
        1,
    )

    # PBXFileReference
    text = text.replace(
        "/* End PBXFileReference section */",
        f"\t\t{IDS['swift_ref']} /* NotificationService.swift */ = "
        f"{{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = NotificationService.swift; sourceTree = \"<group>\"; }};\n"
        f"\t\t{IDS['plist_ref']} /* Info.plist */ = "
        f"{{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = \"<group>\"; }};\n"
        f"\t\t{IDS['appex_ref']} /* FlyFamNotificationService.appex */ = "
        f"{{isa = PBXFileReference; explicitFileType = \"wrapper.app-extension\"; includeInIndex = 0; path = FlyFamNotificationService.appex; sourceTree = BUILT_PRODUCTS_DIR; }};\n"
        "/* End PBXFileReference section */",
        1,
    )

    # Frameworks build phase for NSE (empty)
    text = text.replace(
        "/* End PBXFrameworksBuildPhase section */",
        f"\t\t{IDS['frameworks_phase']} /* Frameworks */ = {{\n"
        f"\t\t\tisa = PBXFrameworksBuildPhase;\n"
        f"\t\t\tbuildActionMask = 2147483647;\n"
        f"\t\t\tfiles = (\n"
        f"\t\t\t);\n"
        f"\t\t\trunOnlyForDeploymentPostprocessing = 0;\n"
        f"\t\t}};\n"
        "/* End PBXFrameworksBuildPhase section */",
        1,
    )

    # Group
    text = text.replace(
        "/* End PBXGroup section */",
        f"\t\t{IDS['group']} /* FlyFamNotificationService */ = {{\n"
        f"\t\t\tisa = PBXGroup;\n"
        f"\t\t\tchildren = (\n"
        f"\t\t\t\t{IDS['swift_ref']} /* NotificationService.swift */,\n"
        f"\t\t\t\t{IDS['plist_ref']} /* Info.plist */,\n"
        f"\t\t\t);\n"
        f"\t\t\tpath = FlyFamNotificationService;\n"
        f"\t\t\tsourceTree = \"<group>\";\n"
        f"\t\t}};\n"
        "/* End PBXGroup section */",
        1,
    )

    # Insert group into main group children — find Products sibling area via FlyFamShareExtension group reference
    # Add to root children near Share Extension group
    if IDS["group"] not in text.split("mainGroup")[0]:
        # Add under project root group: look for CA907744... FlyFamShareExtension in root
        text = text.replace(
            "\t\t\t\tCA907744DAF14235B2EDBB58 /* FlyFamShareExtension */,\n",
            "\t\t\t\tCA907744DAF14235B2EDBB58 /* FlyFamShareExtension */,\n"
            f"\t\t\t\t{IDS['group']} /* FlyFamNotificationService */,\n",
            1,
        )

    # Products group
    text = text.replace(
        "\t\t\t\t9724F026E56347E6B84EF4AF /* FlyFamShareExtension.appex */,\n",
        "\t\t\t\t9724F026E56347E6B84EF4AF /* FlyFamShareExtension.appex */,\n"
        f"\t\t\t\t{IDS['appex_ref']} /* FlyFamNotificationService.appex */,\n",
        1,
    )

    # Native target
    text = text.replace(
        "/* End PBXNativeTarget section */",
        f"\t\t{IDS['target']} /* FlyFamNotificationService */ = {{\n"
        f"\t\t\tisa = PBXNativeTarget;\n"
        f"\t\t\tbuildConfigurationList = {IDS['cfg_list']} /* Build configuration list for PBXNativeTarget \"FlyFamNotificationService\" */;\n"
        f"\t\t\tbuildPhases = (\n"
        f"\t\t\t\t{IDS['sources_phase']} /* Sources */,\n"
        f"\t\t\t\t{IDS['frameworks_phase']} /* Frameworks */,\n"
        f"\t\t\t\t{IDS['resources_phase']} /* Resources */,\n"
        f"\t\t\t);\n"
        f"\t\t\tbuildRules = (\n"
        f"\t\t\t);\n"
        f"\t\t\tdependencies = (\n"
        f"\t\t\t);\n"
        f"\t\t\tname = FlyFamNotificationService;\n"
        f"\t\t\tproductName = FlyFamNotificationService;\n"
        f"\t\t\tproductReference = {IDS['appex_ref']} /* FlyFamNotificationService.appex */;\n"
        f"\t\t\tproductType = \"com.apple.product-type.app-extension\";\n"
        f"\t\t}};\n"
        "/* End PBXNativeTarget section */",
        1,
    )

    # Project targets list + TargetAttributes
    text = text.replace(
        "\t\t\t\t\t5FF537CF1C6C4C639F7DB05F = {\n"
        "\t\t\t\t\t\tLastSwiftMigration = 1250;\n"
        "\t\t\t\t\t};\n",
        "\t\t\t\t\t5FF537CF1C6C4C639F7DB05F = {\n"
        "\t\t\t\t\t\tLastSwiftMigration = 1250;\n"
        "\t\t\t\t\t};\n"
        f"\t\t\t\t\t{IDS['target']} = {{\n"
        f"\t\t\t\t\t\tCreatedOnToolsVersion = 15.0;\n"
        f"\t\t\t\t\t\tLastSwiftMigration = 1500;\n"
        f"\t\t\t\t\t}};\n",
        1,
    )
    text = text.replace(
        "\t\t\t\t5FF537CF1C6C4C639F7DB05F /* FlyFamShareExtension */,\n"
        "\t\t\t);\n"
        "\t\t};\n"
        "/* End PBXProject section */",
        "\t\t\t\t5FF537CF1C6C4C639F7DB05F /* FlyFamShareExtension */,\n"
        f"\t\t\t\t{IDS['target']} /* FlyFamNotificationService */,\n"
        "\t\t\t);\n"
        "\t\t};\n"
        "/* End PBXProject section */",
        1,
    )

    # Resources phase (empty)
    text = text.replace(
        "/* End PBXResourcesBuildPhase section */",
        f"\t\t{IDS['resources_phase']} /* Resources */ = {{\n"
        f"\t\t\tisa = PBXResourcesBuildPhase;\n"
        f"\t\t\tbuildActionMask = 2147483647;\n"
        f"\t\t\tfiles = (\n"
        f"\t\t\t);\n"
        f"\t\t\trunOnlyForDeploymentPostprocessing = 0;\n"
        f"\t\t}};\n"
        "/* End PBXResourcesBuildPhase section */",
        1,
    )

    # Sources phase
    text = text.replace(
        "/* End PBXSourcesBuildPhase section */",
        f"\t\t{IDS['sources_phase']} /* Sources */ = {{\n"
        f"\t\t\tisa = PBXSourcesBuildPhase;\n"
        f"\t\t\tbuildActionMask = 2147483647;\n"
        f"\t\t\tfiles = (\n"
        f"\t\t\t\t{IDS['swift_build']} /* NotificationService.swift in Sources */,\n"
        f"\t\t\t);\n"
        f"\t\t\trunOnlyForDeploymentPostprocessing = 0;\n"
        f"\t\t}};\n"
        "/* End PBXSourcesBuildPhase section */",
        1,
    )

    # Target dependency from main app
    text = text.replace(
        "/* End PBXTargetDependency section */",
        f"\t\t{IDS['dep']} /* PBXTargetDependency */ = {{\n"
        f"\t\t\tisa = PBXTargetDependency;\n"
        f"\t\t\ttarget = {IDS['target']} /* FlyFamNotificationService */;\n"
        f"\t\t\ttargetProxy = {IDS['container']} /* PBXContainerItemProxy */;\n"
        f"\t\t}};\n"
        "/* End PBXTargetDependency section */",
        1,
    )
    # Add dependency to FlyFam native target
    text = text.replace(
        "\t\t\tdependencies = (\n"
        "\t\t\t\tF54EBAD599154DD5B60485FB /* PBXTargetDependency */,\n"
        "\t\t\t);\n"
        "\t\t\tname = FlyFam;\n",
        "\t\t\tdependencies = (\n"
        "\t\t\t\tF54EBAD599154DD5B60485FB /* PBXTargetDependency */,\n"
        f"\t\t\t\t{IDS['dep']} /* PBXTargetDependency */,\n"
        "\t\t\t);\n"
        "\t\t\tname = FlyFam;\n",
        1,
    )

    # Build configurations
    nse_debug = f"""\t\t{IDS['cfg_debug']} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 41;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = FlyFamNotificationService/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 15.1;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = 1.3.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.flyfam.app.NotificationService;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Debug;
		}};
"""
    nse_release = f"""\t\t{IDS['cfg_release']} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 41;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = FlyFamNotificationService/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 15.1;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = 1.3.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.flyfam.app.NotificationService;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Release;
		}};
"""
    text = text.replace(
        "/* End XCBuildConfiguration section */",
        nse_debug + nse_release + "/* End XCBuildConfiguration section */",
        1,
    )

    text = text.replace(
        "/* End XCConfigurationList section */",
        f"\t\t{IDS['cfg_list']} /* Build configuration list for PBXNativeTarget \"FlyFamNotificationService\" */ = {{\n"
        f"\t\t\tisa = XCConfigurationList;\n"
        f"\t\t\tbuildConfigurations = (\n"
        f"\t\t\t\t{IDS['cfg_debug']} /* Debug */,\n"
        f"\t\t\t\t{IDS['cfg_release']} /* Release */,\n"
        f"\t\t\t);\n"
        f"\t\t\tdefaultConfigurationIsVisible = 0;\n"
        f"\t\t\tdefaultConfigurationName = Release;\n"
        f"\t\t}};\n"
        "/* End XCConfigurationList section */",
        1,
    )

    PROJECT.write_text(text, encoding="utf-8")
    print("Added FlyFamNotificationService target to", PROJECT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
