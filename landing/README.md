# PadelNexo landing

Landing estatica oficial para `www.padelnexo.com.ar`.

## Ejecutar localmente

Opcion simple con Node:

```cmd
npx serve landing
```

O con Firebase Hosting Emulator:

```cmd
firebase emulators:start --only hosting
```

## Publicar en Firebase Hosting

```cmd
set "GOOGLE_APPLICATION_CREDENTIALS=C:\Users\Usuario\Downloads\padelnexo-7e4d5-c63d2b56aa18.json"
firebase deploy --only hosting --project padelnexo-7e4d5
```

Para publicar Functions y Hosting juntos:

```cmd
firebase deploy --only functions,hosting --project padelnexo-7e4d5
```

## Dominio

En Firebase Console, ir a Hosting y conectar el dominio:

```text
www.padelnexo.com.ar
```

Firebase indicara los registros DNS necesarios y emitira HTTPS automaticamente cuando el dominio verifique.
