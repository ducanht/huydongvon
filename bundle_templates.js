import fs from 'fs';
import path from 'path';

function main() {
    // Use current working directory dynamically
    const workspaceDir = process.cwd();
    const frontendDir = path.join(workspaceDir, "src", "frontend");
    
    // Read shell
    const shellPath = path.join(frontendDir, "frmShell.html");
    if (!fs.existsSync(shellPath)) {
        console.error(`Error: frmShell.html not found at ${shellPath}`);
        process.exit(1);
    }
    let shellContent = fs.readFileSync(shellPath, "utf8");
        
    // Replace stylesheets
    shellContent = shellContent.replace(
        /<\?\!=\s*include\('src\/frontend\/assets\/css\/app\.css'\);\s*\?>/g,
        '<link rel="stylesheet" href="/src/frontend/assets/css/app.css" />'
    );
    
    // Replace app.js link
    shellContent = shellContent.replace(
        /<\?\!=\s*include\('src\/frontend\/assets\/js\/app\.js'\);\s*\?>/g,
        '<script type="module" src="/src/frontend/main.js"></script>'
    );
    
    // Replace frmDoiMatKhau with direct code if present
    const dmkPath = path.join(frontendDir, "frmDoiMatKhau.html");
    if (fs.existsSync(dmkPath)) {
        const dmkContent = fs.readFileSync(dmkPath, "utf8");
        shellContent = shellContent.replace(
            /<\?\!=\s*include\('src\/frontend\/frmDoiMatKhau'\);\s*\?>/g,
            dmkContent
        );
    }
    
    // Gather templates
    const templates = [];
    const files = fs.readdirSync(frontendDir).sort();
    
    for (const filename of files) {
        if (!filename.endsWith(".html")) {
            continue;
        }
        if (filename === "frmShell.html" || filename === "frmDoiMatKhau.html") {
            continue;
        }
            
        const moduleName = path.parse(filename).name;
        const filePath = path.join(frontendDir, filename);
        const content = fs.readFileSync(filePath, "utf8").trim();
            
        let templateStr = "";
        if (filename === "frmLogin.html") {
            // Extract content between <template id="tpl-frmLogin"> and </template>
            const match = content.match(/<template id="tpl-frmLogin">([\s\S]*?)<\/template>/);
            if (match) {
                const innerContent = match[1].trim();
                templateStr = `<template id="tpl-frmLogin">\n${innerContent}\n</template>`;
            } else {
                templateStr = `<template id="tpl-frmLogin">\n${content}\n</template>`;
            }
        } else {
            templateStr = `<template id="tpl-${moduleName}">\n${content}\n</template>`;
        }
            
        templates.push(templateStr);
    }
        
    const templatesStr = templates.join("\n\n");
    
    // Replace the templates container in shell
    const pattern = /(<div id="html-templates"[^>]*>)[\s\S]*?(<\/div>)/;
    if (pattern.test(shellContent)) {
        shellContent = shellContent.replace(pattern, `$1\n${templatesStr}\n$2`);
        console.log("Successfully replaced html-templates placeholder.");
    } else {
        console.log("Warning: html-templates container placeholder not found!");
    }
        
    // Write output to index.html at root
    const outputPath = path.join(workspaceDir, "index.html");
    fs.writeFileSync(outputPath, shellContent, "utf8");
        
    console.log(`Successfully generated index.html at ${outputPath}`);
}

main();
