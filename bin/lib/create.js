#!/usr/bin/env node

/*
       Licensed to the Apache Software Foundation (ASF) under one
       or more contributor license agreements.  See the NOTICE file
       distributed with this work for additional information
       regarding copyright ownership.  The ASF licenses this file
       to you under the Apache License, Version 2.0 (the
       "License"); you may not use this file except in compliance
       with the License.  You may obtain a copy of the License at

         http://www.apache.org/licenses/LICENSE-2.0

       Unless required by applicable law or agreed to in writing,
       software distributed under the License is distributed on an
       "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
       KIND, either express or implied.  See the License for the
       specific language governing permissions and limitations
       under the License.
*/
var shell = require('shelljs'),
    child_process = require('child_process'),
    Q     = require('q'),
    path  = require('path'),
    fs    = require('fs'),
    check_reqs = require('./check_reqs'),
    ROOT    = path.join(__dirname, '..', '..');

// Returns a promise.
function exec(command, opt_cwd) {
    var d = Q.defer();
    console.log('Running: ' + command);
    child_process.exec(command, { cwd: opt_cwd }, function(err, stdout, stderr) {
        stdout && console.log(stdout);
        stderr && console.error(stderr);
        if (err) d.reject(err);
        else d.resolve(stdout);
    });
    return d.promise;
}

function setShellFatal(value, func) {
    var oldVal = shell.config.fatal;
    shell.config.fatal = value;
    func();
    shell.config.fatal = oldVal;
}

function getFrameworkDir(projectPath, shared) {
    return shared ? path.join(ROOT, 'framework') : path.join(projectPath, 'CordovaLib');
}

function copyJsAndLibrary(projectPath, shared, projectName) {
    var nestedCordovaLibPath = getFrameworkDir(projectPath, false);
    shell.cp('-f', path.join(ROOT, 'framework', 'assets', 'www', 'cordova.js'), path.join(projectPath, 'assets', 'www', 'cordova.js'));
    // Don't fail if there are no old jars.
    setShellFatal(false, function() {
        shell.ls(path.join(projectPath, 'libs', 'cordova-*.jar')).forEach(function(oldJar) {
            console.log("Deleting " + oldJar);
            shell.rm('-f', oldJar);
        });
        // Delete old library project if it existed.
        if (shared) {
            shell.rm('-rf', nestedCordovaLibPath);
        } else {
            // Delete only the src, since eclipse can't handle its .project file being deleted.
            shell.rm('-rf', path.join(nestedCordovaLibPath, 'src'));
        }
    });
    if (!shared) {
        shell.mkdir('-p', nestedCordovaLibPath);
        shell.mkdir('-p', path.join(ROOT, 'framework', 'libs'));
        shell.cp('-f', path.join(ROOT, 'framework', 'AndroidManifest.xml'), nestedCordovaLibPath);
        shell.cp('-f', path.join(ROOT, 'framework', 'project.properties'), nestedCordovaLibPath);
        shell.cp('-f', path.join(ROOT, 'framework', 'build.gradle'), nestedCordovaLibPath);
        shell.cp('-r', path.join(ROOT, 'framework', 'src'), nestedCordovaLibPath);
        shell.cp('-r', path.join(ROOT, 'framework', 'libs'), nestedCordovaLibPath);
        // Create an eclipse project file and set the name of it to something unique.
        // Without this, you can't import multiple CordovaLib projects into the same workspace.
        var eclipseProjectFilePath = path.join(nestedCordovaLibPath, '.project');
        if (!fs.existsSync(eclipseProjectFilePath)) {
            var data = '<?xml version="1.0" encoding="UTF-8"?><projectDescription><name>' + projectName + '-' + 'CordovaLib</name></projectDescription>';
            fs.writeFileSync(eclipseProjectFilePath, data, 'utf8');
        }
    }
}

function extractSubProjectPaths(data) {
    var ret = {};
    var r = /^\s*android\.library\.reference\.\d+=(.*)(?:\s|$)/mg
    var m;
    while (m = r.exec(data)) {
        ret[m[1]] = 1;
    }
    return Object.keys(ret);
}

function writeProjectProperties(projectPath, target_api, shared) {
    var dstPath = path.join(projectPath, 'project.properties');
    var templatePath = path.join(ROOT, 'bin', 'templates', 'project', 'project.properties');
    var srcPath = fs.existsSync(dstPath) ? dstPath : templatePath;
    var data = fs.readFileSync(srcPath, 'utf8');
    data = data.replace(/^target=.*/m, 'target=' + target_api);
    var subProjects = extractSubProjectPaths(data);
    subProjects = subProjects.filter(function(p) {
        return !(/^CordovaLib$/m.exec(p) ||
                 /[\\\/]cordova-android[\\\/]framework$/m.exec(p) ||
                 /^(\.\.[\\\/])+framework$/m.exec(p)
                 );
    });
    subProjects.unshift(shared ? path.relative(projectPath, path.join(ROOT, 'framework')) : 'CordovaLib');
    data = data.replace(/^\s*android\.library\.reference\.\d+=.*\n/mg, '');
    if (!/\n$/.exec(data)) {
        data += '\n';
    }
    for (var i = 0; i < subProjects.length; ++i) {
        data += 'android.library.reference.' + (i+1) + '=' + subProjects[i] + '\n';
    }
    fs.writeFileSync(dstPath, data);
}

function copyBuildRules(projectPath) {
    var srcDir = path.join(ROOT, 'bin', 'templates', 'project');
    shell.cp('-f', path.join(srcDir, 'custom_rules.xml'), projectPath);

    shell.cp('-f', path.join(srcDir, 'build.gradle'), projectPath);
    shell.cp('-f', path.join(srcDir, 'cordova.gradle'), projectPath);
}

function copyScripts(projectPath) {
    var srcScriptsDir = path.join(ROOT, 'bin', 'templates', 'cordova');
    var destScriptsDir = path.join(projectPath, 'cordova');
    // Delete old scripts directory if this is an update.
    shell.rm('-rf', destScriptsDir);
    // Copy in the new ones.
    shell.cp('-r', srcScriptsDir, projectPath);
    [
        'build',
        'clean',
        'log',
         'run',
         'version',
    ].forEach(function(f) { 
           shell.chmod(755, path.join(destScriptsDir, f));
    });
    shell.cp('-r', path.join(ROOT, 'bin', 'node_modules'), destScriptsDir);
    shell.cp(path.join(ROOT, 'bin', 'check_reqs'), path.join(destScriptsDir, 'check_reqs'));
    shell.cp(path.join(ROOT, 'bin', 'lib', 'check_reqs.js'), path.join(projectPath, 'cordova', 'lib', 'check_reqs.js'));
    shell.cp(path.join(ROOT, 'bin', 'android_sdk_version'), path.join(destScriptsDir, 'android_sdk_version'));
    shell.cp(path.join(ROOT, 'bin', 'lib', 'android_sdk_version.js'), path.join(projectPath, 'cordova', 'lib', 'android_sdk_version.js'));
}

/**
 * Test whether a package name is acceptable for use as an android project.
 * Returns a promise, fulfilled if the package name is acceptable; rejected
 * otherwise.
 */
function validatePackageName(package_name) {
    //Make the package conform to Java package types
    //Enforce underscore limitation
    if (!/^[a-zA-Z]+(\.[a-zA-Z0-9][a-zA-Z0-9_]*)+$/.test(package_name)) {
        return Q.reject('Package name must look like: com.company.Name');
    }

    //Class is a reserved word
    if(/\b[Cc]lass\b/.test(package_name)) {
        return Q.reject('class is a reserved word');
    }

    return Q.resolve();
}

/**
 * Test whether a project name is acceptable for use as an android class.
 * Returns a promise, fulfilled if the project name is acceptable; rejected
 * otherwise.
 */
function validateProjectName(project_name) {
    //Make sure there's something there
    if (project_name === '') {
        return Q.reject('Project name cannot be empty');
    }

    //Enforce stupid name error
    if (project_name === 'CordovaActivity') {
        return Q.reject('Project name cannot be CordovaActivity');
    }

    //Classes in Java don't begin with numbers
    if (/^[0-9]/.test(project_name)) {
        return Q.reject('Project name must not begin with a number');
    }

    return Q.resolve();
}

/**
 * $ create [options]
 *
 * Creates an android application with the given options.
 *
 * Options:
 *
 *   - `project_path` 	{String} Path to the new Cordova android project.
 *   - `package_name`{String} Package name, following reverse-domain style convention.
 *   - `project_name` 	{String} Project name.
 *   - 'project_template_dir' {String} Path to project template (override).
 *
 * Returns a promise.
 */

exports.createProject = function(project_path, package_name, project_name, project_template_dir, use_shared_project, use_cli_template) {
    var VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf-8').trim();
    var awv_interface='awv_interface.jar';
    
    // Set default values for path, package and name
    project_path = typeof project_path !== 'undefined' ? project_path : "CordovaExample";
    project_path = path.relative(process.cwd(), project_path);
    package_name = typeof package_name !== 'undefined' ? package_name : 'my.cordova.project';
    project_name = typeof project_name !== 'undefined' ? project_name : 'CordovaExample';
    project_template_dir = typeof project_template_dir !== 'undefined' ? 
                           project_template_dir : 
                           path.join(ROOT, 'bin', 'templates', 'project');

    var package_as_path = package_name.replace(/\./g, path.sep);
    var activity_dir    = path.join(project_path, 'src', package_as_path);
    // safe_activity_name is being hardcoded to avoid issues with unicode app name (https://issues.apache.org/jira/browse/CB-6511)
    // TODO: provide option to specify activity name via CLI (proposal: https://issues.apache.org/jira/browse/CB-7231)
    var safe_activity_name = 'MainActivity';
    var activity_path   = path.join(activity_dir, safe_activity_name + '.java');
    var target_api      = check_reqs.get_target();
    var manifest_path   = path.join(project_path, 'AndroidManifest.xml');

    // Check if project already exists
    if(fs.existsSync(project_path)) {
        return Q.reject('Project already exists! Delete and recreate');
    }
  
    //See if commonlibs exists under root .cordova folder. If not, prompt the error and exit
    var HOME = process.env[(process.platform.slice(0, 3) == 'win') ? 'USERPROFILE' : 'HOME'];
    var global_config_path = path.join(HOME, '.cordova');
    var lib_path = path.join(global_config_path, 'lib');
    var awv_sdk_expected_path=path.join(lib_path, 'commonlibs');
    var awv_interface_jar_commonlib_path = path.join(awv_sdk_expected_path, awv_interface);
    console.log('Checking if awv sdk is installed at : ' + awv_sdk_expected_path);
    if (!fs.existsSync(awv_sdk_expected_path) || !fs.existsSync(awv_interface_jar_commonlib_path)) {
        shell.mkdir('-p',awv_sdk_expected_path);
        var msg = '\n*********************************\n\nAmazon WebView API Library Not Found.\n\nPlease download the AmazonWebView SDK from:\n\nhttps://developer.amazon.com/public/solutions/platforms/android-fireos/docs/building-and-testing-your-hybrid-app\n\nThen copy awv_interface.jar from the SDK into this folder:\n\n' + awv_sdk_expected_path + '\n\nRe-run \'cordova platform add amazon-fireos\' to finish adding Amazon Fire OS support to your project.\n\n*********************************\n';
        console.log(msg);
        return Q.resolve();

    } 
    //Copy awv_interface.jar to ~/.cordova/lib/amazon-fireos/cordova/[cordova_release]/framework/libs folder.
    var awv_interface_expected_path=path.join(ROOT, 'framework','libs');
    console.log('awv_path : ' + awv_interface_expected_path);
    if (!fs.existsSync(awv_interface_expected_path) || !fs.existsSync(path.join(awv_interface_expected_path, awv_interface))) {
        shell.mkdir('-p', awv_interface_expected_path);
        shell.cp(awv_interface_jar_commonlib_path, awv_interface_expected_path);
    } 

    //Make the package conform to Java package types
    return validatePackageName(package_name)
    .then(function() {
        validateProjectName(project_name);
    }).then(function() {
        // Log the given values for the project
        console.log('Creating Cordova project for the amazon-fireos platform:');
        console.log('\tPath: ' + project_path);
        console.log('\tPackage: ' + package_name);
        console.log('\tName: ' + project_name);
        console.log('\tAndroid target: ' + target_api);

        console.log('Copying template files...');

        setShellFatal(true, function() {
            // copy project template
            shell.cp('-r', path.join(project_template_dir, 'assets'), project_path);
            shell.cp('-r', path.join(project_template_dir, 'res'), project_path);
            shell.cp('-r', path.join(ROOT, 'framework', 'res', 'xml'), path.join(project_path, 'res'));
            shell.cp(path.join(project_template_dir, 'gitignore'), path.join(project_path, '.gitignore'));

            // Manually create directories that would be empty within the template (since git doesn't track directories).
            shell.mkdir(path.join(project_path, 'libs'));
            // Add in the proper eclipse project file.
            if (use_cli_template) {
                shell.cp(path.join(project_template_dir, 'eclipse-project-CLI'), path.join(project_path, '.project'));
            } else {
                shell.cp(path.join(project_template_dir, 'eclipse-project'), path.join(project_path, '.project'));
            }

            // copy cordova.js, cordova.jar and res/xml
            copyJsAndLibrary(project_path, use_shared_project, safe_activity_name);

            // interpolate the activity name and package
            shell.mkdir('-p', activity_dir);
            shell.cp('-f', path.join(project_template_dir, 'Activity.java'), activity_path);
            shell.sed('-i', /__ACTIVITY__/, safe_activity_name, activity_path);
            shell.sed('-i', /__NAME__/, project_name, path.join(project_path, 'res', 'values', 'strings.xml'));
            shell.sed('-i', /__NAME__/, project_name, path.join(project_path, '.project'));
            shell.sed('-i', /__ID__/, package_name, activity_path);

            shell.cp('-f', path.join(project_template_dir, 'AndroidManifest.xml'), manifest_path);
            shell.sed('-i', /__ACTIVITY__/, safe_activity_name, manifest_path);
            shell.sed('-i', /__PACKAGE__/, package_name, manifest_path);
            shell.sed('-i', /__APILEVEL__/, target_api.split('-')[1], manifest_path);
            copyScripts(project_path);
            copyBuildRules(project_path);
        });
        // Link it to local android install.
        writeProjectProperties(project_path, target_api, use_shared_project);
    }).then(function() {
        console.log('Project successfully created.');
    });
}

// Attribute removed in Cordova 4.4 (CB-5447).
function removeDebuggableFromManifest(projectPath) {
    var manifestPath   = path.join(projectPath, 'AndroidManifest.xml');
    shell.sed('-i', /\s*android:debuggable="true"/, '', manifestPath);
}

function extractProjectNameFromManifest(projectPath) {
    var manifestPath = path.join(projectPath, 'AndroidManifest.xml');
    var manifestData = fs.readFileSync(manifestPath, 'utf8');
    var m = /<activity[\s\S]*?android:name\s*=\s*"(.*?)"/i.exec(manifestData);
    if (!m) {
      throw new Error('Could not find activity name in ' + manifestPath);
    }
    return m[1];
}
 
// Returns a promise.
exports.updateProject = function(projectPath, shared) {
    var newVersion = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf-8').trim();
    return Q()
    .then(function() {
        var projectName = extractProjectNameFromManifest(projectPath);
        var target_api = check_reqs.get_target();
        copyJsAndLibrary(projectPath, shared, projectName);
        copyScripts(projectPath);
        copyBuildRules(projectPath);
        removeDebuggableFromManifest(projectPath);
        writeProjectProperties(projectPath, target_api, shared);
        console.log('amazon-fireos project is now at version ' + newVersion);
        console.log('If you updated from a pre-3.2.0 version and use an IDE, we now require that you import the "CordovaLib" library project.');
    });
};


// For testing
exports.validatePackageName = validatePackageName;
exports.validateProjectName = validateProjectName;
